import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * /api/agents executed for real, with the auth guard and the Supabase Auth
 * Admin API mocked out.
 *
 * What these are for: onboarding writes to two systems that cannot be put in
 * one transaction — a login in auth.users and a row in agent_profiles — so
 * every interesting case is a partial one. Who may call it, what a retry does
 * after each half has failed, and whether a second press can produce a second
 * profile or a second login.
 */

const requireAdmin = vi.fn();
vi.mock("@/lib/auth/guard", () => ({
  requireAdmin: () => requireAdmin(),
  requireUser: () => requireAdmin(),
}));

const getAdminAuth = vi.fn();
vi.mock("@/lib/supabase/admin-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/admin-auth")>();
  return { ...actual, getAdminAuth: () => getAdminAuth() };
});

const { AdminAuthUnavailableError } = await import("@/lib/supabase/admin-auth");
const { GET, POST, PATCH } = await import("@/app/api/agents/route");

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface Op {
  table: string;
  kind: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
  terminal?: string;
}

type Responder = (op: Op) => { data: unknown; error: unknown };

/** Just enough PostgREST builder to run the handlers unmodified. */
function makeSupabase(respond: Responder) {
  const ops: Op[] = [];

  const from = vi.fn((table: string) => {
    const op: Op = { table, kind: "select", filters: {} };
    const finish = (terminal: string) => {
      op.terminal = terminal;
      ops.push(op);
      return Promise.resolve(respond(op));
    };
    const builder = {
      select: () => builder,
      insert: (payload: Record<string, unknown>) => {
        op.kind = "insert";
        op.payload = payload;
        return builder;
      },
      update: (payload: Record<string, unknown>) => {
        op.kind = "update";
        op.payload = payload;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        op.filters[column] = value;
        return builder;
      },
      order: () => finish("order"),
      maybeSingle: () => finish("maybeSingle"),
      single: () => finish("single"),
    };
    return builder;
  });

  return { client: { from } as unknown as SupabaseClient, ops };
}

const ADMIN_AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function signedInAsAdmin(respond: Responder) {
  const supabase = makeSupabase(respond);
  requireAdmin.mockResolvedValue({
    ok: true,
    agent: { id: ADMIN_AGENT_ID, user_id: "admin-user", role: "admin", is_active: true },
    supabase: supabase.client,
    userId: "admin-user",
  });
  return supabase;
}

function refused(status: number, message: string) {
  requireAdmin.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: message }, { status }),
  });
}

/**
 * A fake Auth Admin API over an in-memory auth.users. `listUsers` and
 * `inviteUserByEmail` behave the way GoTrue does, including refusing to create
 * a second user for an address that already has one.
 */
function fakeAuthUsers(seed: { id: string; email: string }[] = []) {
  const users = [...seed];
  const listUsers = vi.fn(async () => ({ data: { users: [...users] }, error: null }));
  const inviteUserByEmail = vi.fn(async (email: string) => {
    if (users.some((u) => u.email === email)) {
      return {
        data: { user: null },
        error: { message: "User already registered", status: 422, code: "email_exists" },
      };
    }
    const user = { id: `auth-${users.length + 1}`, email };
    users.push(user);
    return { data: { user }, error: null };
  });
  return { users, listUsers, inviteUserByEmail };
}

function post(body: unknown) {
  return new NextRequest("https://app.tweakandbuild.com/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patch(body: unknown) {
  return new NextRequest("https://app.tweakandbuild.com/api/agents", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** No profile exists; the insert succeeds and echoes the row back. */
function happyDatabase(): Responder {
  return (op) =>
    op.kind === "insert"
      ? {
          data: { id: "profile-1", created_at: "2026-01-01T00:00:00Z", ...op.payload },
          error: null,
        }
      : { data: null, error: null };
}

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  requireAdmin.mockReset();
  getAdminAuth.mockReset();
  process.env.APP_BASE_URL = "https://app.tweakandbuild.com";
  // The handlers log the underlying failure on purpose; keep it out of the
  // test output, and assert on the response body instead.
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------

describe("who may onboard an agent", () => {
  it("refuses an unauthenticated caller and touches nothing", async () => {
    refused(401, "Unauthorized");
    const res = await POST(post({ display_name: "Mary", email: "mary@example.com" }));
    expect(res.status).toBe(401);
    expect(getAdminAuth).not.toHaveBeenCalled();
  });

  it("refuses a signed-in agent — no invite, no profile", async () => {
    refused(403, "Admin access required");
    const res = await POST(post({ display_name: "Mary", email: "mary@example.com" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Admin access required" });
    // The Auth Admin API is never even constructed for a non-admin.
    expect(getAdminAuth).not.toHaveBeenCalled();
  });

  it("refuses a non-admin on GET and PATCH too", async () => {
    refused(403, "Admin access required");
    expect((await GET()).status).toBe(403);
    expect((await PATCH(patch({ id: OTHER_AGENT_ID, is_active: false }))).status).toBe(403);
  });
});

describe("input validation", () => {
  const bad = [
    ["a blank display name", { display_name: "", email: "mary@example.com" }],
    ["a whitespace-only display name", { display_name: "   ", email: "mary@example.com" }],
    ["a missing display name", { email: "mary@example.com" }],
    ["an invalid email", { display_name: "Mary", email: "mary@" }],
    ["a missing email", { display_name: "Mary" }],
    ["an empty body", {}],
  ] as const;

  for (const [label, body] of bad) {
    it(`rejects ${label} with a 400 and sends no invitation`, async () => {
      const auth = fakeAuthUsers();
      getAdminAuth.mockReturnValue(auth);
      const db = signedInAsAdmin(happyDatabase());

      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid input");
      expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
      expect(db.ops).toEqual([]);
    });
  }

  it("rejects malformed JSON rather than throwing", async () => {
    getAdminAuth.mockReturnValue(fakeAuthUsers());
    signedInAsAdmin(happyDatabase());
    const res = await POST(
      new NextRequest("https://app.tweakandbuild.com/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })
    );
    expect(res.status).toBe(400);
  });

  /**
   * The capability that is gone: a client naming the auth.users row a profile
   * attaches to. It is refused outright rather than ignored, so nobody can
   * believe it was honoured.
   */
  it("refuses a client-supplied user_id, and never writes one", async () => {
    const auth = fakeAuthUsers();
    getAdminAuth.mockReturnValue(auth);
    const db = signedInAsAdmin(happyDatabase());

    const res = await POST(
      post({
        display_name: "Mary",
        email: "mary@example.com",
        user_id: "11111111-1111-4111-8111-111111111111",
      })
    );

    expect(res.status).toBe(400);
    expect(db.ops).toEqual([]);
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("refuses a client-chosen role", async () => {
    getAdminAuth.mockReturnValue(fakeAuthUsers());
    const db = signedInAsAdmin(happyDatabase());
    const res = await POST(
      post({ display_name: "Mary", email: "mary@example.com", role: "admin" })
    );
    expect(res.status).toBe(400);
    expect(db.ops).toEqual([]);
  });
});

describe("a brand-new email", () => {
  it("invites the person and creates their agent profile", async () => {
    const auth = fakeAuthUsers();
    getAdminAuth.mockReturnValue(auth);
    const db = signedInAsAdmin(happyDatabase());

    const res = await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.outcome).toBe("invited");
    expect(body.agent).toMatchObject({
      display_name: "Mary Chen",
      email: "mary@example.com",
      role: "agent",
      is_active: true,
      user_id: "auth-1",
    });

    expect(auth.inviteUserByEmail).toHaveBeenCalledWith("mary@example.com", {
      data: { display_name: "Mary Chen" },
      redirectTo: "https://app.tweakandbuild.com/setup-password",
    });

    const insert = db.ops.find((o) => o.kind === "insert")!;
    expect(insert.table).toBe("agent_profiles");
    // Exactly these columns: the role and the active flag are the server's,
    // and nothing else from the request reaches the row.
    expect(Object.keys(insert.payload!).sort()).toEqual([
      "display_name",
      "email",
      "is_active",
      "role",
      "user_id",
    ]);
    expect(insert.payload).toMatchObject({ role: "agent", is_active: true });
  });

  it("normalises the email before inviting and before storing it", async () => {
    const auth = fakeAuthUsers();
    getAdminAuth.mockReturnValue(auth);
    const db = signedInAsAdmin(happyDatabase());

    await POST(post({ display_name: "  Mary Chen  ", email: "  Mary@Example.COM " }));

    expect(auth.inviteUserByEmail.mock.calls[0][0]).toBe("mary@example.com");
    const insert = db.ops.find((o) => o.kind === "insert")!;
    expect(insert.payload).toMatchObject({
      email: "mary@example.com",
      display_name: "Mary Chen",
    });
  });
});

describe("an email that already has a login", () => {
  it("links it to a new profile instead of failing", async () => {
    const auth = fakeAuthUsers([{ id: "auth-existing", email: "mary@example.com" }]);
    getAdminAuth.mockReturnValue(auth);
    const db = signedInAsAdmin(happyDatabase());

    const res = await POST(post({ display_name: "Mary Chen", email: "Mary@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.outcome).toBe("linked");
    expect(body.agent.user_id).toBe("auth-existing");
    // The profile is attached to the login they already had, at the default
    // role, active.
    expect(db.ops.find((o) => o.kind === "insert")!.payload).toMatchObject({
      user_id: "auth-existing",
      role: "agent",
      is_active: true,
    });
    // No second invitation to somebody who already has an account.
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("refuses with a 409 when that login already has a profile", async () => {
    const auth = fakeAuthUsers([{ id: "auth-existing", email: "mary@example.com" }]);
    getAdminAuth.mockReturnValue(auth);
    const db = signedInAsAdmin((op) =>
      op.kind === "select" && op.terminal === "maybeSingle"
        ? {
            data: { id: "profile-9", display_name: "Mary Chen", email: "mary@example.com" },
            error: null,
          }
        : { data: null, error: null }
    );

    const res = await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("profile_exists");
    expect(body.error).toMatch(/already has an agent profile/i);
    // Nothing was written, and nobody was emailed.
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("cannot be duplicated by two requests racing past the pre-check", async () => {
    const auth = fakeAuthUsers([{ id: "auth-existing", email: "mary@example.com" }]);
    getAdminAuth.mockReturnValue(auth);
    // The pre-check sees nothing; UNIQUE(user_id) catches it at the insert.
    signedInAsAdmin((op) =>
      op.kind === "insert"
        ? { data: null, error: { code: "23505", message: 'duplicate key value violates "agent_profiles_user_id_key"' } }
        : { data: null, error: null }
    );

    const res = await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("profile_exists");
    // The constraint's own wording never reaches the browser.
    expect(JSON.stringify(body)).not.toMatch(/duplicate key|agent_profiles_user_id_key/);
  });
});

describe("double submission", () => {
  /**
   * Two presses of the button against one shared auth.users and one shared
   * agent_profiles. The end state must be one login and one profile, whichever
   * order they land in.
   */
  it("creates one auth user and one profile, and answers the second with a 409", async () => {
    const auth = fakeAuthUsers();
    getAdminAuth.mockReturnValue(auth);

    const profiles: Record<string, unknown>[] = [];
    const responder: Responder = (op) => {
      if (op.kind === "insert") {
        const userId = op.payload!.user_id as string;
        if (profiles.some((p) => p.user_id === userId)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const row = { id: `profile-${profiles.length + 1}`, ...op.payload };
        profiles.push(row);
        return { data: row, error: null };
      }
      const match = profiles.find((p) => p.user_id === op.filters.user_id);
      return { data: match ?? null, error: null };
    };
    signedInAsAdmin(responder);

    const first = await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }));
    const second = await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(profiles).toHaveLength(1);
    expect(auth.users).toHaveLength(1);
    expect(auth.inviteUserByEmail).toHaveBeenCalledTimes(1);
  });
});

describe("partial failure and retry", () => {
  /**
   * The case with no transaction to lean on: the invitation went out, and the
   * profile insert then failed. The auth user is left alone — deleting it
   * would destroy an account the invitee may already have accepted — and the
   * admin is told the invite landed so that pressing the button again is
   * obviously the right move.
   */
  it("reports an invite that landed with a profile that did not, and keeps the user", async () => {
    const auth = fakeAuthUsers();
    getAdminAuth.mockReturnValue(auth);
    signedInAsAdmin((op) => {
      if (op.kind === "insert") throw new Error("connection terminated unexpectedly");
      return { data: null, error: null };
    });

    const res = await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.invite_sent).toBe(true);
    expect(body.error).toMatch(/was invited/i);
    expect(body.error).toMatch(/again/i);
    // The login survives the failure — that is what makes the retry a link.
    expect(auth.users).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/connection terminated/);
  });

  it("finishes the job on the retry, linking the user the first attempt invited", async () => {
    const auth = fakeAuthUsers();
    getAdminAuth.mockReturnValue(auth);

    let failNextInsert = true;
    signedInAsAdmin((op) => {
      if (op.kind === "insert") {
        if (failNextInsert) {
          failNextInsert = false;
          throw new Error("connection terminated unexpectedly");
        }
        return { data: { id: "profile-1", ...op.payload }, error: null };
      }
      return { data: null, error: null };
    });

    const first = await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }));
    expect(first.status).toBe(500);

    const retry = await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }));
    const body = await retry.json();

    expect(retry.status).toBe(201);
    expect(body.outcome).toBe("linked");
    expect(body.agent.user_id).toBe("auth-1");
    // Still one login, and only ever one invitation email.
    expect(auth.users).toHaveLength(1);
    expect(auth.inviteUserByEmail).toHaveBeenCalledTimes(1);
  });

  it("says the profile failed without claiming an invite when the user already existed", async () => {
    const auth = fakeAuthUsers([{ id: "auth-existing", email: "mary@example.com" }]);
    getAdminAuth.mockReturnValue(auth);
    signedInAsAdmin((op) => {
      if (op.kind === "insert") throw new Error("boom");
      return { data: null, error: null };
    });

    const body = await (
      await POST(post({ display_name: "Mary Chen", email: "mary@example.com" }))
    ).json();

    expect(body.invite_sent).toBe(false);
    expect(body.error).not.toMatch(/was invited/i);
  });
});

describe("failures from Supabase Auth", () => {
  it("answers 502 when the invitation cannot be sent, and leaks no detail", async () => {
    const auth = fakeAuthUsers();
    auth.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: {
        message: "over_email_send_rate_limit: project quota exceeded",
        status: 429,
        code: "over_email_send_rate_limit",
      },
    });
    getAdminAuth.mockReturnValue(auth);
    const db = signedInAsAdmin(happyDatabase());

    const res = await POST(post({ display_name: "Mary", email: "mary@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe("Could not send the invitation. Try again.");
    expect(JSON.stringify(body)).not.toMatch(/rate_limit|quota/);
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
  });

  it("answers 502 when the user lookup fails, without inviting anybody", async () => {
    const auth = fakeAuthUsers();
    auth.listUsers.mockResolvedValue({
      data: { users: [] },
      error: { message: "gotrue unavailable", status: 503 },
    } as never);
    getAdminAuth.mockReturnValue(auth);
    signedInAsAdmin(happyDatabase());

    const res = await POST(post({ display_name: "Mary", email: "mary@example.com" }));
    expect(res.status).toBe(502);
    expect(auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("tells the admin where to look when an existing login cannot be matched", async () => {
    const auth = fakeAuthUsers();
    auth.listUsers.mockResolvedValue({ data: { users: [] }, error: null } as never);
    auth.inviteUserByEmail.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered", status: 422, code: "email_exists" },
    });
    getAdminAuth.mockReturnValue(auth);
    const db = signedInAsAdmin(happyDatabase());

    const res = await POST(post({ display_name: "Mary", email: "mary@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already has a login/i);
    expect(db.ops.some((o) => o.kind === "insert")).toBe(false);
  });

  it("answers 503 when the server has no service-role key configured", async () => {
    getAdminAuth.mockImplementation(() => {
      throw new AdminAuthUnavailableError();
    });
    const db = signedInAsAdmin(happyDatabase());

    const res = await POST(post({ display_name: "Mary", email: "mary@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toMatch(/not configured/i);
    expect(db.ops).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The handlers onboarding did not change
// ---------------------------------------------------------------------------

describe("GET is unchanged", () => {
  it("returns every agent profile, ordered, to an admin", async () => {
    const rows = [{ id: "1", display_name: "Ada" }, { id: "2", display_name: "Mary" }];
    const db = signedInAsAdmin((op) =>
      op.terminal === "order" ? { data: rows, error: null } : { data: null, error: null }
    );

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agents: rows });
    expect(db.ops[0]).toMatchObject({ table: "agent_profiles", terminal: "order" });
  });

  it("reports a query failure as a 500 without the database's wording", async () => {
    signedInAsAdmin(() => ({ data: null, error: { message: "relation does not exist" } }));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to fetch agents" });
  });
});

describe("PATCH is unchanged, self-lockout protections included", () => {
  it("refuses an admin removing their own admin role", async () => {
    const db = signedInAsAdmin(happyDatabase());
    const res = await PATCH(patch({ id: ADMIN_AGENT_ID, role: "agent" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot remove your own admin role/i);
    // Refused before any update is issued, not rolled back after one.
    expect(db.ops).toEqual([]);
  });

  it("refuses an admin deactivating their own account", async () => {
    const db = signedInAsAdmin(happyDatabase());
    const res = await PATCH(patch({ id: ADMIN_AGENT_ID, is_active: false }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot deactivate your own account/i);
    expect(db.ops).toEqual([]);
  });

  it("still lets an admin promote themselves and rename themselves", async () => {
    const db = signedInAsAdmin((op) =>
      op.kind === "update"
        ? { data: { id: ADMIN_AGENT_ID, ...op.payload }, error: null }
        : { data: null, error: null }
    );

    const res = await PATCH(patch({ id: ADMIN_AGENT_ID, role: "admin", display_name: "Boss" }));
    expect(res.status).toBe(200);
    expect(db.ops[0].payload).toEqual({ role: "admin", display_name: "Boss" });
  });

  it("still deactivates and promotes other agents", async () => {
    const db = signedInAsAdmin((op) =>
      op.kind === "update"
        ? { data: { id: OTHER_AGENT_ID, ...op.payload }, error: null }
        : { data: null, error: null }
    );

    const off = await PATCH(patch({ id: OTHER_AGENT_ID, is_active: false }));
    expect(off.status).toBe(200);
    expect((await off.json()).agent.is_active).toBe(false);

    const up = await PATCH(patch({ id: OTHER_AGENT_ID, role: "admin" }));
    expect(up.status).toBe(200);
    expect(db.ops.every((o) => o.filters.id === OTHER_AGENT_ID)).toBe(true);
  });

  it("rejects a malformed update", async () => {
    signedInAsAdmin(happyDatabase());
    const res = await PATCH(patch({ id: "not-a-uuid", is_active: false }));
    expect(res.status).toBe(400);
  });
});
