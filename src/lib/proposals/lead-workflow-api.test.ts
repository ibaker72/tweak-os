import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * The two routes behind "Start from a Lead", executed for real against a
 * recording stand-in for the Supabase client. What matters here is the shape
 * of what they ask the database for — that the picker is bounded, that search
 * happens server-side, and that a proposal can only be attached to a lead the
 * caller can actually see.
 */

const requireUser = vi.fn();
vi.mock("@/lib/auth/guard", () => ({
  requireUser: () => requireUser(),
  requireAdmin: () => requireUser(),
}));

const { GET: getLeads } = await import("@/app/api/proposals/leads/route");
const { POST: saveProposal } = await import("@/app/api/proposals/route");

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD_ID = "22222222-2222-4222-8222-222222222222";
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";

type Op = [string, unknown[]];

interface Query {
  table: string;
  ops: Op[];
}

/** Every op this query recorded for a given method name. */
function args(query: Query, method: string): unknown[][] {
  return query.ops.filter(([name]) => name === method).map(([, a]) => a);
}

type Responder = (query: Query) => { data: unknown; error: unknown } | undefined;

/**
 * A chainable stand-in for the query builder. It records what was asked and
 * hands back whatever the test's responder returns, so an assertion can be
 * made about the query itself and not just its result.
 */
function fakeSupabase(responder: Responder = () => undefined) {
  const queries: Query[] = [];

  const builder = (table: string) => {
    const query: Query = { table, ops: [] };
    queries.push(query);

    const chain: Record<string, unknown> = {
      then(
        resolve: (value: { data: unknown; error: unknown }) => unknown,
        reject?: (reason: unknown) => unknown
      ) {
        const result = responder(query) ?? { data: [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };

    for (const method of [
      "select", "insert", "update", "eq", "in", "is", "not", "or",
      "gte", "lte", "order", "limit", "maybeSingle", "single",
    ]) {
      chain[method] = (...callArgs: unknown[]) => {
        query.ops.push([method, callArgs]);
        return chain;
      };
    }

    return chain;
  };

  return { queries, client: { from: (table: string) => builder(table) } };
}

function signedIn(supabase: unknown, role: "admin" | "agent" = "agent") {
  requireUser.mockResolvedValue({
    ok: true,
    agent: { id: "agent-1", role },
    supabase,
    userId: "user-1",
  });
}

function signedOut() {
  requireUser.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
}

function pickerRequest(search = "") {
  return new NextRequest(`https://app.tweakandbuild.com/api/proposals/leads${search}`);
}

function savePost(body: unknown) {
  return new NextRequest("https://app.tweakandbuild.com/api/proposals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function leadRow(id: string, extra: Record<string, unknown> = {}) {
  return { id, business_name: `Business ${id}`, ...extra };
}

beforeEach(() => {
  requireUser.mockReset();
});

describe("GET /api/proposals/leads — recommended list", () => {
  it("refuses an unauthenticated caller", async () => {
    signedOut();
    const res = await getLeads(pickerRequest());
    expect(res.status).toBe(401);
  });

  it("returns a short list, never the whole leads table", async () => {
    const { client, queries } = fakeSupabase((q) =>
      q.table === "leads"
        ? { data: Array.from({ length: 8 }, (_, i) => leadRow(`lead-${q.ops.length}-${i}`)), error: null }
        : undefined
    );
    signedIn(client);

    const body = await (await getLeads(pickerRequest())).json();

    expect(body.mode).toBe("recommended");
    expect(body.leads).toHaveLength(8);

    const leadQueries = queries.filter((q) => q.table === "leads");
    expect(leadQueries.length).toBeGreaterThan(0);
    for (const query of leadQueries) {
      const limits = args(query, "limit").map(([n]) => n as number);
      expect(limits).toHaveLength(1);
      expect(limits[0]).toBeLessThanOrEqual(8);
    }
  });

  it("caps an over-large limit rather than honouring it", async () => {
    const { client } = fakeSupabase();
    signedIn(client);
    const res = await getLeads(pickerRequest("?limit=500"));
    expect(res.status).toBe(400);
  });

  it("asks only for active leads", async () => {
    const { client, queries } = fakeSupabase();
    signedIn(client);
    await getLeads(pickerRequest());

    for (const query of queries.filter((q) => q.table === "leads")) {
      expect(args(query, "is")).toContainEqual(["archived_at", null]);
      expect(args(query, "is")).toContainEqual(["deleted_at", null]);
    }
  });

  it("adds no ownership filter of its own — RLS decides who sees what", async () => {
    const { client, queries } = fakeSupabase();
    signedIn(client);
    await getLeads(pickerRequest());

    for (const query of queries.filter((q) => q.table === "leads")) {
      for (const [column] of args(query, "eq") as [string][]) {
        expect(column).not.toBe("assigned_to");
      }
    }
  });

  it("narrows to one signal when the filter asks for it", async () => {
    const { client, queries } = fakeSupabase();
    signedIn(client);
    await getLeads(pickerRequest("?focus=hot"));

    const leadQueries = queries.filter((q) => q.table === "leads");
    expect(leadQueries).toHaveLength(1);
    expect(args(leadQueries[0], "gte")).toContainEqual(["score", 70]);
  });

  it("flags leads that already have a proposal", async () => {
    const { client } = fakeSupabase((q) => {
      if (q.table === "leads") return { data: [leadRow(LEAD_ID), leadRow(OTHER_LEAD_ID)], error: null };
      if (q.table === "proposals")
        return {
          data: [
            { id: "p1", lead_id: LEAD_ID, status: "draft", created_at: "2026-09-01T00:00:00Z", total_one_time: 2500, total_monthly: 0 },
            { id: "p2", lead_id: LEAD_ID, status: "sent", created_at: "2026-09-03T00:00:00Z", total_one_time: 3500, total_monthly: 0 },
          ],
          error: null,
        };
      return undefined;
    });
    signedIn(client);

    const body = await (await getLeads(pickerRequest())).json();
    const flagged = body.leads.find((l: { id: string }) => l.id === LEAD_ID);
    const clean = body.leads.find((l: { id: string }) => l.id === OTHER_LEAD_ID);

    expect(flagged.proposal_count).toBe(2);
    expect(flagged.latest_proposal.id).toBe("p2");
    expect(clean.proposal_count).toBe(0);
  });

  it("looks up one lead when the page was opened from that lead", async () => {
    const { client, queries } = fakeSupabase((q) =>
      q.table === "leads" ? { data: leadRow(LEAD_ID, { niche: "HVAC" }), error: null } : undefined
    );
    signedIn(client);

    const body = await (await getLeads(pickerRequest(`?lead_id=${LEAD_ID}`))).json();

    expect(body.mode).toBe("single");
    expect(body.leads).toHaveLength(1);
    expect(queries.filter((q) => q.table === "leads")).toHaveLength(1);
  });

  it("returns nothing for a lead the caller may not see", async () => {
    // RLS-scoped read: an unauthorized id comes back as no row at all.
    const { client } = fakeSupabase((q) =>
      q.table === "leads" ? { data: null, error: null } : undefined
    );
    signedIn(client);

    const body = await (await getLeads(pickerRequest(`?lead_id=${OTHER_LEAD_ID}`))).json();
    expect(body.leads).toEqual([]);
  });
});

describe("GET /api/proposals/leads — search", () => {
  it("searches on the server, across the useful fields", async () => {
    const { client, queries } = fakeSupabase((q) =>
      q.table === "leads" ? { data: [leadRow(LEAD_ID, { business_name: "Acme HVAC" })], error: null } : undefined
    );
    signedIn(client);

    const body = await (await getLeads(pickerRequest("?q=acme"))).json();

    expect(body.mode).toBe("search");
    expect(body.leads).toHaveLength(1);

    const leadQueries = queries.filter((q) => q.table === "leads");
    expect(leadQueries).toHaveLength(1);
    const [[filter]] = args(leadQueries[0], "or") as [string][];
    for (const column of ["business_name", "contact_name", "email", "phone", "city", "website"]) {
      expect(filter).toContain(`${column}.ilike.%acme%`);
    }
    expect(args(leadQueries[0], "limit")[0][0]).toBeLessThanOrEqual(8);
  });

  it("does not query at all for a one-character search", async () => {
    const { client, queries } = fakeSupabase();
    signedIn(client);

    const body = await (await getLeads(pickerRequest("?q=a"))).json();

    expect(body.leads).toEqual([]);
    expect(queries.filter((q) => q.table === "leads")).toHaveLength(0);
  });

  it("cannot be talked into a wider filter through the search box", async () => {
    const { client, queries } = fakeSupabase();
    signedIn(client);
    await getLeads(pickerRequest(`?q=${encodeURIComponent("x,assigned_to.not.is.null")}`));

    const [[filter]] = args(queries.filter((q) => q.table === "leads")[0], "or") as [string][];
    // The comma is gone, so the injected text can only survive as literal
    // characters inside one ilike pattern — never as a clause of its own.
    const clauses = filter.split(",");
    expect(clauses).toHaveLength(6);
    for (const clause of clauses) {
      expect(clause).toMatch(/^(business_name|contact_name|email|phone|city|website)\.ilike\.%.*%$/);
    }
  });
});

describe("POST /api/proposals — the lead link", () => {
  const draft = {
    client_name: "Acme HVAC",
    business_type: "HVAC",
    website_url: "https://acme-hvac.com",
    proposal_html: "# Proposal",
  };

  function respondForSave(leadVisible: boolean): Responder {
    return (q) => {
      if (q.table === "leads") return { data: leadVisible ? { id: LEAD_ID } : null, error: null };
      if (q.table === "proposals")
        return { data: { id: PROPOSAL_ID, created_at: "2026-09-03T00:00:00Z" }, error: null };
      return undefined;
    };
  }

  function insertedRow(queries: Query[]): Record<string, unknown> | undefined {
    const insert = queries
      .filter((q) => q.table === "proposals")
      .flatMap((q) => args(q, "insert"))[0];
    return insert?.[0] as Record<string, unknown> | undefined;
  }

  it("stores the lead id on a proposal started from a lead", async () => {
    const { client, queries } = fakeSupabase(respondForSave(true));
    signedIn(client);

    const res = await saveProposal(savePost({ ...draft, lead_id: LEAD_ID }));

    expect(res.status).toBe(200);
    expect(insertedRow(queries)?.lead_id).toBe(LEAD_ID);
  });

  it("still saves a proposal built by hand, with no lead", async () => {
    const { client, queries } = fakeSupabase(respondForSave(true));
    signedIn(client);

    const res = await saveProposal(savePost(draft));

    expect(res.status).toBe(200);
    expect(insertedRow(queries)?.lead_id).toBeNull();
    // No lead was named, so no lead was read.
    expect(queries.filter((q) => q.table === "leads")).toHaveLength(0);
  });

  it("refuses a lead the caller cannot see, and writes nothing", async () => {
    const { client, queries } = fakeSupabase(respondForSave(false));
    signedIn(client);

    const res = await saveProposal(savePost({ ...draft, lead_id: OTHER_LEAD_ID }));

    expect(res.status).toBe(403);
    expect(queries.filter((q) => q.table === "proposals")).toHaveLength(0);
  });

  it("lets a second proposal reference the same lead", async () => {
    const { client, queries } = fakeSupabase(respondForSave(true));
    signedIn(client);

    await saveProposal(savePost({ ...draft, lead_id: LEAD_ID }));
    await saveProposal(savePost({ ...draft, client_name: "Acme HVAC — v2", lead_id: LEAD_ID }));

    const inserts = queries
      .filter((q) => q.table === "proposals")
      .flatMap((q) => args(q, "insert"))
      .map(([row]) => row as Record<string, unknown>);

    expect(inserts).toHaveLength(2);
    expect(inserts.every((row) => row.lead_id === LEAD_ID)).toBe(true);
  });

  it("never touches the lead itself — no ownership, attribution or status change", async () => {
    const { client, queries } = fakeSupabase(respondForSave(true));
    signedIn(client);

    await saveProposal(savePost({ ...draft, lead_id: LEAD_ID }));

    const leadQueries = queries.filter((q) => q.table === "leads");
    expect(leadQueries).toHaveLength(1);
    // A single read, and nothing else.
    expect(args(leadQueries[0], "select")).toEqual([["id"]]);
    expect(args(leadQueries[0], "update")).toEqual([]);
    expect(args(leadQueries[0], "insert")).toEqual([]);
  });

  it("leaves an existing link alone when an edit does not mention a lead", async () => {
    const { client, queries } = fakeSupabase(respondForSave(true));
    signedIn(client);

    await saveProposal(savePost({ ...draft, id: PROPOSAL_ID }));

    const [[row]] = queries
      .filter((q) => q.table === "proposals")
      .flatMap((q) => args(q, "update")) as [Record<string, unknown>][];

    expect(Object.keys(row)).not.toContain("lead_id");
  });

  it("writes the link on an edit that does name a lead", async () => {
    const { client, queries } = fakeSupabase(respondForSave(true));
    signedIn(client);

    await saveProposal(savePost({ ...draft, id: PROPOSAL_ID, lead_id: LEAD_ID }));

    const [[row]] = queries
      .filter((q) => q.table === "proposals")
      .flatMap((q) => args(q, "update")) as [Record<string, unknown>][];

    expect(row.lead_id).toBe(LEAD_ID);
  });

  it("attributes the proposal to the caller, never to the lead's owner", async () => {
    const { client, queries } = fakeSupabase(respondForSave(true));
    signedIn(client);

    await saveProposal(savePost({ ...draft, lead_id: LEAD_ID }));

    expect(insertedRow(queries)?.created_by).toBe("agent-1");
  });
});
