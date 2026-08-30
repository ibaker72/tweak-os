import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/voice/call, executed for real with the auth guard and the calling
 * service mocked out. The point of these is the boundary: who is allowed to
 * call it, and what the body is and is not allowed to contain.
 */

const requireUser = vi.fn();
vi.mock("@/lib/auth/guard", () => ({
  requireUser: () => requireUser(),
  requireAdmin: () => requireUser(),
}));

const initiateVoiceCall = vi.fn();
vi.mock("@/lib/voice/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return { ...actual, initiateVoiceCall: (...a: unknown[]) => initiateVoiceCall(...a) };
});

const { POST } = await import("@/app/api/voice/call/route");

const LEAD_ID = "11111111-1111-4111-8111-111111111111";

// The route's rate limiter buckets by agent id in module state, which is
// shared across every test in this file. Each test therefore signs in as a
// fresh agent so it starts with a full budget; the rate-limit test below is
// the one place that deliberately reuses one.
let agentCounter = 0;

function signedIn(id?: string) {
  requireUser.mockResolvedValue({
    ok: true,
    agent: { id: id ?? `agent-${++agentCounter}`, role: "agent" },
    supabase: {},
    userId: "user-1",
  });
}

function signedOut() {
  requireUser.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
}

function post(body: unknown, url = "https://app.tweakandbuild.com/api/voice/call") {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireUser.mockReset();
  initiateVoiceCall.mockReset();
  initiateVoiceCall.mockResolvedValue({
    ok: true,
    reason: "calling",
    message: "Calling your phone… Answer to connect to the prospect.",
    call_id: "call-1",
    twilio_call_sid: "CA1",
    error_message: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("authentication", () => {
  it("rejects an unauthenticated caller with 401", async () => {
    signedOut();
    const res = await POST(post({ lead_id: LEAD_ID }));
    expect(res.status).toBe(401);
    expect(initiateVoiceCall).not.toHaveBeenCalled();
  });

  it("does no work at all before the guard passes", async () => {
    signedOut();
    await POST(post({ lead_id: LEAD_ID, prospect_phone: "+19999999999" }));
    expect(initiateVoiceCall).not.toHaveBeenCalled();
  });
});

describe("the client cannot choose who gets dialed", () => {
  const forbidden = [
    { field: "prospect_phone", body: { lead_id: LEAD_ID, prospect_phone: "+19999999999" } },
    { field: "agent_phone", body: { lead_id: LEAD_ID, agent_phone: "+15550001111" } },
    { field: "agent_id", body: { lead_id: LEAD_ID, agent_id: "agent-2" } },
    { field: "from_number", body: { lead_id: LEAD_ID, from_number: "+16660000000" } },
    { field: "caller_id", body: { lead_id: LEAD_ID, caller_id: "+16660000000" } },
    { field: "to", body: { lead_id: LEAD_ID, to: "+19999999999" } },
  ];

  for (const { field, body } of forbidden) {
    it(`rejects a body carrying ${field}`, async () => {
      signedIn();
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.reason).toBe("invalid_input");
      expect(json.message).toMatch(/lead_id only/);
      // Nothing was placed, so there is nothing to have overridden.
      expect(initiateVoiceCall).not.toHaveBeenCalled();
    });
  }

  it("passes only the lead id through to the calling service", async () => {
    signedIn();
    await POST(post({ lead_id: LEAD_ID }));
    const [, input] = initiateVoiceCall.mock.calls[0];
    expect(Object.keys(input).sort()).toEqual(["baseUrl", "leadId"]);
    expect(input.leadId).toBe(LEAD_ID);
  });

  it("hands the service the request-scoped client, never a service-role one", async () => {
    const supabase = { marker: "rls-bound" };
    requireUser.mockResolvedValue({
      ok: true,
      agent: { id: `agent-${++agentCounter}`, role: "agent" },
      supabase,
      userId: "user-1",
    });
    await POST(post({ lead_id: LEAD_ID }));
    expect(initiateVoiceCall.mock.calls[0][0]).toBe(supabase);
  });
});

describe("input validation", () => {
  it("rejects a missing lead id", async () => {
    signedIn();
    expect((await POST(post({}))).status).toBe(400);
  });

  it("rejects a lead id that is not a uuid", async () => {
    signedIn();
    expect((await POST(post({ lead_id: "not-a-uuid" }))).status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    signedIn();
    const req = new NextRequest("https://app.tweakandbuild.com/api/voice/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("invalid_body");
  });
});

describe("outcomes", () => {
  it("returns 404 for a lead the caller cannot see", async () => {
    signedIn();
    initiateVoiceCall.mockResolvedValue({
      ok: false,
      reason: "lead_not_found",
      message: "Lead not found or not assigned to you.",
      call_id: null,
      twilio_call_sid: null,
      error_message: null,
    });
    const res = await POST(post({ lead_id: LEAD_ID }));
    expect(res.status).toBe(404);
    expect((await res.json()).ok).toBe(false);
  });

  it("returns 200 with a clear message when voice is disabled", async () => {
    signedIn();
    initiateVoiceCall.mockResolvedValue({
      ok: false,
      reason: "disabled",
      message: "Twilio Voice is currently disabled. The call was not placed.",
      call_id: "call-1",
      twilio_call_sid: null,
      error_message: null,
    });
    const res = await POST(post({ lead_id: LEAD_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("disabled");
    expect(json.message).toBe("Twilio Voice is currently disabled. The call was not placed.");
  });

  it("surfaces Twilio's failure detail for the debug UI", async () => {
    signedIn();
    initiateVoiceCall.mockResolvedValue({
      ok: false,
      reason: "twilio_error",
      message: "Twilio rejected the call — the account cannot place calls right now.",
      call_id: "call-1",
      twilio_call_sid: null,
      error_message: "Account suspended",
    });
    const json = await (await POST(post({ lead_id: LEAD_ID }))).json();
    expect(json.error_message).toBe("Account suspended");
  });

  it("does not leak internals when the service throws", async () => {
    signedIn();
    initiateVoiceCall.mockRejectedValue(new Error("connection string postgres://secret"));
    const res = await POST(post({ lead_id: LEAD_ID }));
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("postgres://secret");
  });

  it("resolves the callback origin from the forwarded headers", async () => {
    signedIn();
    const req = new NextRequest("http://internal-host/api/voice/call", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "app.tweakandbuild.com",
      },
      body: JSON.stringify({ lead_id: LEAD_ID }),
    });
    await POST(req);
    expect(initiateVoiceCall.mock.calls[0][1].baseUrl).toBe("https://app.tweakandbuild.com");
  });
});

describe("rate limiting", () => {
  it("stops a client that keeps pressing the button", async () => {
    signedIn("rate-limited-agent");
    let limited = false;
    for (let i = 0; i < 30; i++) {
      const res = await POST(post({ lead_id: LEAD_ID }));
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
