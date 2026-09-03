import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET and PATCH /api/my/voice-phone, executed for real against a fake
 * Supabase, with the auth guard mocked.
 *
 * This is the route that lost the number in production: the callback field was
 * saved, the request answered 200, and the column was NULL afterwards, because
 * an empty box was read as "erase it". The assertions below are mostly about
 * that one distinction — a blank submission must not be able to erase anything
 * — plus the rule that a success reported here is a value the next GET
 * returns.
 */

const requireUser = vi.fn();
vi.mock("@/lib/auth/guard", () => ({
  requireUser: () => requireUser(),
  requireAdmin: () => requireUser(),
}));

const { GET, PATCH } = await import("@/app/api/my/voice-phone/route");
const { getCallbackPhone, CALLBACK_PHONE_TABLE, CALLBACK_PHONE_COLUMN } =
  await import("@/lib/voice/callback-phone");

const AGENT_ID = "3bdc0777-0dbe-4fbe-958f-2d05e8e307c9";

/** The stored column, and a switch for making the read or the write fail. */
let stored: string | null;
let rpcCalls: { name: string; args: Record<string, unknown> }[];
let failSelect = false;
let rpcError: { message: string } | null = null;
/** Simulates a write the database reports as done but does not actually keep. */
let dropWrites = false;

function fakeSupabase() {
  return {
    from(table: string) {
      if (table !== "agent_profiles") throw new Error(`Unexpected table ${table}`);
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          if (failSelect) return { data: null, error: { message: "boom" } };
          // Only ever the caller's own row.
          if (filters.id !== undefined && filters.id !== AGENT_ID) {
            return { data: null, error: null };
          }
          return { data: { voice_phone: stored }, error: null };
        },
      };
      return builder;
    },

    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      if (name !== "set_my_voice_phone") throw new Error(`Unexpected rpc ${name}`);

      const phone = args.p_phone as string | null;
      const clear = args.p_clear as boolean;
      const blank = phone === null || String(phone).trim() === "";

      if (blank && !clear) {
        return {
          data: { ok: false, reason: "blank_without_clear", voice_phone: stored },
          error: null,
        };
      }
      if (blank) {
        if (!dropWrites) stored = null;
        return { data: { ok: true, cleared: true, voice_phone: null }, error: null };
      }

      // Mirrors private.normalize_phone closely enough for these assertions.
      const cleaned = String(phone).replace(/[^\d+]/g, "");
      let normalized: string | null = null;
      if (cleaned.startsWith("+")) normalized = cleaned.length >= 8 ? cleaned : null;
      else if (cleaned.length === 10) normalized = `+1${cleaned}`;
      else if (cleaned.length === 11 && cleaned.startsWith("1")) normalized = `+${cleaned}`;

      if (normalized === null) {
        return { data: { ok: false, reason: "invalid_phone" }, error: null };
      }
      if (!dropWrites) stored = normalized;
      return {
        data: { ok: true, cleared: false, voice_phone: normalized },
        error: null,
      };
    },
  };
}

function signedIn() {
  requireUser.mockResolvedValue({
    ok: true,
    agent: { id: AGENT_ID, role: "admin", is_active: true },
    supabase: fakeSupabase(),
    userId: "2bfca884-b71a-4084-8798-f35dbea383e9",
  });
}

function signedOut() {
  requireUser.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
}

function patch(body: unknown) {
  return new NextRequest("https://app.tweakandbuild.com/api/my/voice-phone", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireUser.mockReset();
  stored = null;
  rpcCalls = [];
  failSelect = false;
  rpcError = null;
  dropWrites = false;
  signedIn();
});

describe("GET /api/my/voice-phone", () => {
  it("requires a session", async () => {
    signedOut();
    expect((await GET()).status).toBe(401);
  });

  it("returns null when nothing has been saved", async () => {
    expect(await (await GET()).json()).toEqual({ voice_phone: null });
  });

  it("loads the saved callback number", async () => {
    stored = "+18622984988";
    expect(await (await GET()).json()).toEqual({ voice_phone: "+18622984988" });
  });

  it("reports a read failure rather than pretending nothing is saved", async () => {
    failSelect = true;
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/load/i);
  });
});

describe("PATCH /api/my/voice-phone", () => {
  it("requires a session", async () => {
    signedOut();
    expect((await PATCH(patch({ voice_phone: "+18622984988" }))).status).toBe(401);
  });

  it("saves a number and normalises it to E.164", async () => {
    const res = await PATCH(patch({ voice_phone: "(862) 298-4988" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      cleared: false,
      voice_phone: "+18622984988",
    });
    expect(stored).toBe("+18622984988");
  });

  it("accepts a bare ten-digit US number", async () => {
    await PATCH(patch({ voice_phone: "8622984988" }));
    expect(stored).toBe("+18622984988");
  });

  it("accepts a number already in E.164", async () => {
    await PATCH(patch({ voice_phone: "+18622984988" }));
    expect(stored).toBe("+18622984988");
  });

  it("what it saved is what the next GET returns", async () => {
    const saved = await (await PATCH(patch({ voice_phone: "862-298-4988" }))).json();
    expect((await (await GET()).json()).voice_phone).toBe(saved.voice_phone);
  });

  it("rejects a number it could not dial, and changes nothing", async () => {
    stored = "+18622984988";
    const res = await PATCH(patch({ voice_phone: "call me maybe" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/phone number/i);
    expect(stored).toBe("+18622984988");
  });

  // --- the production failure ---------------------------------------------

  it("does NOT erase a saved number when the field is submitted empty", async () => {
    stored = "+18622984988";
    const res = await PATCH(patch({ voice_phone: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/nothing was changed/i);
    expect(stored).toBe("+18622984988");
  });

  it("does NOT erase a saved number when the field is submitted null", async () => {
    stored = "+18622984988";
    const res = await PATCH(patch({ voice_phone: null }));
    expect(res.status).toBe(400);
    expect(stored).toBe("+18622984988");
  });

  it("never reaches the database for a blank submission without clear", async () => {
    stored = "+18622984988";
    await PATCH(patch({ voice_phone: "   " }));
    expect(rpcCalls).toEqual([]);
  });

  it("clears the number only when clearing is asked for explicitly", async () => {
    stored = "+18622984988";
    const res = await PATCH(patch({ voice_phone: null, clear: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cleared: true, voice_phone: null });
    expect(stored).toBeNull();
  });

  it("passes the clear intent through to the database function", async () => {
    await PATCH(patch({ voice_phone: null, clear: true }));
    expect(rpcCalls).toEqual([
      { name: "set_my_voice_phone", args: { p_phone: null, p_clear: true } },
    ]);
  });

  // --- failure is never reported as success --------------------------------

  it("reports a DB failure instead of a silent success", async () => {
    rpcError = { message: "could not find the function" };
    const res = await PATCH(patch({ voice_phone: "+18622984988" }));
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBeUndefined();
  });

  it("refuses to confirm a save the column did not keep", async () => {
    // The function claims success but the value is not in the column
    // afterwards. This is the shape of the original bug, and it must surface
    // as an error rather than as a saved number.
    dropWrites = true;
    const res = await PATCH(patch({ voice_phone: "+18622984988" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/unchanged/i);
    expect(stored).toBeNull();
  });

  it("refuses to confirm a clear the column did not keep", async () => {
    stored = "+18622984988";
    dropWrites = true;
    const res = await PATCH(patch({ voice_phone: null, clear: true }));
    expect(res.status).toBe(500);
    expect(stored).toBe("+18622984988");
  });

  // --- the body is not a place to name someone else -------------------------

  it("rejects a body that tries to name another agent or another number", async () => {
    for (const body of [
      { voice_phone: "+18622984988", agent_id: AGENT_ID },
      { voice_phone: "+18622984988", user_id: "someone-else" },
      { voice_phone: "+18622984988", id: AGENT_ID },
    ]) {
      const res = await PATCH(patch(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(rpcCalls).toEqual([]);
  });

  it("never sends an agent identifier to the database function", async () => {
    // set_my_voice_phone() resolves the agent from the JWT. If this route ever
    // started passing one, the client would be able to choose whose number to
    // change.
    await PATCH(patch({ voice_phone: "+18622984988" }));
    const args = Object.keys(rpcCalls[0].args);
    expect(args.sort()).toEqual(["p_clear", "p_phone"]);
  });

  it("rejects a body that is not JSON", async () => {
    const req = new NextRequest("https://app.tweakandbuild.com/api/my/voice-phone", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect((await PATCH(req)).status).toBe(400);
  });
});

describe("getCallbackPhone", () => {
  const rows = [
    { id: AGENT_ID, user_id: "user-a", voice_phone: "+18622984988" },
    { id: "agent-b", user_id: "user-b", voice_phone: "+19735550000" },
  ];

  function client() {
    return {
      from(table: string) {
        if (table !== CALLBACK_PHONE_TABLE) throw new Error(`Unexpected ${table}`);
        const filters: Record<string, unknown> = {};
        let selected = "";
        const builder = {
          select(columns: string) {
            selected = columns;
            return builder;
          },
          eq(column: string, value: unknown) {
            filters[column] = value;
            return builder;
          },
          async maybeSingle() {
            // The select list is asserted here so a widened projection — which
            // would pull the rest of the profile through this path — fails.
            expect(selected).toBe(CALLBACK_PHONE_COLUMN);
            const match = rows.find((r) =>
              Object.entries(filters).every(
                ([k, v]) => (r as Record<string, unknown>)[k] === v
              )
            );
            return {
              data: match ? { voice_phone: match.voice_phone } : null,
              error: null,
            };
          },
        };
        return builder;
      },
    } as unknown as Parameters<typeof getCallbackPhone>[0];
  }

  it("reads the canonical table and column", () => {
    expect(CALLBACK_PHONE_TABLE).toBe("agent_profiles");
    expect(CALLBACK_PHONE_COLUMN).toBe("voice_phone");
  });

  it("finds the row by agent_profiles id", async () => {
    expect(await getCallbackPhone(client(), { agentId: AGENT_ID })).toBe(
      "+18622984988"
    );
  });

  it("finds the same row by auth user id", async () => {
    // The lead page has the auth user; the API routes have the agent id. Both
    // have to land on the same row, or the two surfaces disagree.
    expect(await getCallbackPhone(client(), { userId: "user-a" })).toBe(
      "+18622984988"
    );
  });

  it("returns null rather than throwing when nothing is set", async () => {
    expect(await getCallbackPhone(client(), { agentId: "nobody" })).toBeNull();
  });

  it("surfaces a read error instead of reporting no number", async () => {
    const failing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof getCallbackPhone>[0];

    await expect(getCallbackPhone(failing, { agentId: AGENT_ID })).rejects.toBeTruthy();
  });
});
