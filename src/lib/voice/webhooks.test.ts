import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { computeTwilioSignature } from "@/lib/sms/signature";

/**
 * The two Twilio webhooks, executed for real against a fake Supabase.
 *
 * These are the endpoints with no session behind them, so the assertions that
 * matter are: an unsigned or wrongly-signed request gets nothing, and the
 * number that ends up in the TwiML came out of the call record rather than out
 * of the request.
 */

const AUTH_TOKEN = "test-auth-token";
const FROM_NUMBER = "+18622984988";
const PROSPECT = "+19735551234";
const TOKEN = "tok-abc123";

interface CallRow {
  id: string;
  status: string;
  prospect_phone: string | null;
  answered_at: string | null;
  completed_at: string | null;
  created_at: string;
  lead_id: string;
  agent_id: string;
  bridge_token: string;
  twilio_call_sid: string | null;
}

let rows: CallRow[] = [];
let updates: { id: string; patch: Record<string, unknown> }[] = [];
let activityInserts: Record<string, unknown>[] = [];

/**
 * Enough of the Supabase query builder for these two routes: eq() filters,
 * maybeSingle() resolves, update().eq() records, insert() collects.
 */
function makeServiceClient() {
  return {
    from(table: string) {
      if (table === "activity_log") {
        return {
          insert: async (row: Record<string, unknown>) => {
            activityInserts.push(row);
            return { error: null };
          },
        };
      }
      if (table !== "voice_calls") throw new Error(`Unexpected table ${table}`);

      const filters: Record<string, unknown> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          const match = rows.find((r) =>
            Object.entries(filters).every(
              ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v
            )
          );
          return { data: match ?? null, error: null };
        },
        update(patch: Record<string, unknown>) {
          return {
            async eq(column: string, value: unknown) {
              const target = rows.find(
                (r) => (r as unknown as Record<string, unknown>)[column] === value
              );
              if (target) {
                updates.push({ id: target.id, patch });
                Object.assign(target, patch);
              }
              return { error: null };
            },
          };
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => makeServiceClient(),
}));

const { POST: bridgePost } = await import(
  "@/app/api/webhooks/twilio/voice/bridge/route"
);
const { POST: statusPost } = await import(
  "@/app/api/webhooks/twilio/voice/status/route"
);

const ORIGINAL_ENV = { ...process.env };

function signedRequest(
  url: string,
  params: Record<string, string>,
  options: { signature?: string | null } = {}
): NextRequest {
  const body = new URLSearchParams(params).toString();
  const signature =
    options.signature === undefined
      ? computeTwilioSignature(AUTH_TOKEN, url, params)
      : options.signature;

  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (signature !== null) headers["x-twilio-signature"] = signature;

  return new NextRequest(url, { method: "POST", headers, body });
}

function bridgeUrlFor(token = TOKEN) {
  return `https://app.tweakandbuild.com/api/webhooks/twilio/voice/bridge?token=${token}`;
}
function statusUrlFor(token = TOKEN) {
  return `https://app.tweakandbuild.com/api/webhooks/twilio/voice/status?token=${token}`;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.TWILIO_FROM_NUMBER = FROM_NUMBER;
  process.env.TWILIO_ACCOUNT_SID = "AC123";
  process.env.APP_BASE_URL = "https://app.tweakandbuild.com";
  delete process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE;

  updates = [];
  activityInserts = [];
  rows = [
    {
      id: "call-1",
      status: "initiated",
      prospect_phone: PROSPECT,
      answered_at: null,
      completed_at: null,
      created_at: new Date().toISOString(),
      lead_id: "lead-1",
      agent_id: "agent-1",
      bridge_token: TOKEN,
      twilio_call_sid: "CA1",
    },
  ];
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

describe("bridge — signature validation", () => {
  it("dials only for a correctly signed request", async () => {
    const res = await bridgePost(signedRequest(bridgeUrlFor(), { CallSid: "CA1" }));
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(xml).toContain(`<Number>${PROSPECT}</Number>`);
  });

  it("refuses a request with no signature header", async () => {
    const res = await bridgePost(
      signedRequest(bridgeUrlFor(), { CallSid: "CA1" }, { signature: null })
    );
    const xml = await res.text();
    expect(xml).not.toContain("<Dial");
    expect(xml).toContain("<Hangup/>");
  });

  it("refuses a tampered signature", async () => {
    const res = await bridgePost(
      signedRequest(bridgeUrlFor(), { CallSid: "CA1" }, { signature: "bogus" })
    );
    expect(await res.text()).not.toContain("<Dial");
  });

  it("refuses when the signature was computed over different params", async () => {
    // Signed for one payload, sent with another — this is the replay case.
    const url = bridgeUrlFor();
    const signature = computeTwilioSignature(AUTH_TOKEN, url, { CallSid: "CA1" });
    const req = new NextRequest(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      body: new URLSearchParams({ CallSid: "CA-other" }).toString(),
    });
    expect(await (await bridgePost(req)).text()).not.toContain("<Dial");
  });

  it("refuses when a token in the URL was swapped, because the URL is signed", async () => {
    const signature = computeTwilioSignature(AUTH_TOKEN, bridgeUrlFor("tok-abc123"), {
      CallSid: "CA1",
    });
    const req = new NextRequest(bridgeUrlFor("tok-somebody-elses"), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      body: new URLSearchParams({ CallSid: "CA1" }).toString(),
    });
    expect(await (await bridgePost(req)).text()).not.toContain("<Dial");
  });

  it("refuses everything when the auth token is not configured", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await bridgePost(signedRequest(bridgeUrlFor(), { CallSid: "CA1" }));
    expect(await res.text()).not.toContain("<Dial");
  });
});

describe("bridge — the number comes from the call record", () => {
  beforeEach(() => {
    process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE = "false";
  });

  function unsigned(url: string, params: Record<string, string> = {}) {
    return new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  }

  it("resolves the prospect from the token, ignoring anything in the body", async () => {
    const xml = await (
      await bridgePost(
        unsigned(bridgeUrlFor(), {
          CallSid: "CA1",
          // A hostile payload naming its own number.
          To: "+19999999999",
          Called: "+19999999999",
          ProspectPhone: "+19999999999",
        })
      )
    ).text();

    expect(xml).toContain(`<Number>${PROSPECT}</Number>`);
    expect(xml).not.toContain("+19999999999");
  });

  it("sets callerId to TWILIO_FROM_NUMBER", async () => {
    const xml = await (await bridgePost(unsigned(bridgeUrlFor()))).text();
    expect(xml).toContain(`callerId="${FROM_NUMBER}"`);
  });

  it("never puts the agent's own phone in the TwiML", async () => {
    const xml = await (await bridgePost(unsigned(bridgeUrlFor()))).text();
    expect(xml).not.toContain("+15550001111");
  });

  it("refuses to dial when TWILIO_FROM_NUMBER is unset rather than guessing one", async () => {
    delete process.env.TWILIO_FROM_NUMBER;
    const xml = await (await bridgePost(unsigned(bridgeUrlFor()))).text();
    expect(xml).not.toContain("<Dial");
  });

  it("refuses an unknown token", async () => {
    const xml = await (await bridgePost(unsigned(bridgeUrlFor("nope")))).text();
    expect(xml).not.toContain("<Dial");
  });

  it("refuses when there is no token at all", async () => {
    const xml = await (
      await bridgePost(
        unsigned("https://app.tweakandbuild.com/api/webhooks/twilio/voice/bridge")
      )
    ).text();
    expect(xml).not.toContain("<Dial");
  });

  it("refuses to re-bridge a completed call", async () => {
    rows[0].status = "completed";
    const xml = await (await bridgePost(unsigned(bridgeUrlFor()))).text();
    expect(xml).not.toContain("<Dial");
  });

  it("refuses a stale token", async () => {
    rows[0].created_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const xml = await (await bridgePost(unsigned(bridgeUrlFor()))).text();
    expect(xml).not.toContain("<Dial");
  });

  it("refuses a record with no prospect number", async () => {
    rows[0].prospect_phone = null;
    const xml = await (await bridgePost(unsigned(bridgeUrlFor()))).text();
    expect(xml).not.toContain("<Dial");
  });

  it("marks the agent leg answered when Twilio fetches the TwiML", async () => {
    await bridgePost(unsigned(bridgeUrlFor()));
    expect(updates[0].patch.status).toBe("in-progress");
    expect(updates[0].patch.answered_at).toBeTruthy();
  });

  it("never asks Twilio to record", async () => {
    const xml = await (await bridgePost(unsigned(bridgeUrlFor()))).text();
    expect(xml.toLowerCase()).not.toContain("record");
  });
});

// ---------------------------------------------------------------------------
// Status callback
// ---------------------------------------------------------------------------

describe("status — signature validation", () => {
  it("ignores an unsigned request", async () => {
    const res = await statusPost(
      signedRequest(
        statusUrlFor(),
        { CallSid: "CA1", CallStatus: "completed", CallDuration: "42" },
        { signature: null }
      )
    );
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it("ignores a tampered signature", async () => {
    await statusPost(
      signedRequest(
        statusUrlFor(),
        { CallSid: "CA1", CallStatus: "completed" },
        { signature: "nope" }
      )
    );
    expect(updates).toHaveLength(0);
  });

  it("accepts a correctly signed request", async () => {
    await statusPost(
      signedRequest(statusUrlFor(), {
        CallSid: "CA1",
        CallStatus: "ringing",
      })
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.status).toBe("ringing");
  });
});

describe("status — updates", () => {
  beforeEach(() => {
    process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE = "false";
  });

  function post(params: Record<string, string>, url = statusUrlFor()) {
    return new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  }

  it("persists a completed call with its duration", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "completed", CallDuration: "42" }));
    expect(updates[0].patch).toMatchObject({
      status: "completed",
      duration_seconds: 42,
    });
    expect(updates[0].patch.completed_at).toBeTruthy();
  });

  it("persists no-answer without inventing a duration", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "no-answer" }));
    expect(updates[0].patch.status).toBe("no-answer");
    expect(updates[0].patch).not.toHaveProperty("duration_seconds");
  });

  it("persists busy and canceled", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "busy" }));
    expect(updates[0].patch.status).toBe("busy");

    rows[0].status = "initiated";
    updates = [];
    await statusPost(post({ CallSid: "CA1", CallStatus: "canceled" }));
    expect(updates[0].patch.status).toBe("canceled");
  });

  it("keeps Twilio's error detail on a failure", async () => {
    await statusPost(
      post({
        CallSid: "CA1",
        CallStatus: "failed",
        ErrorCode: "13224",
        ErrorMessage: "Dial: Invalid phone number",
      })
    );
    expect(updates[0].patch.status).toBe("failed");
    expect(updates[0].patch.error_message).toContain("13224");
    expect(updates[0].patch.error_message).toContain("Invalid phone number");
  });

  it("sets answered_at on in-progress", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "in-progress" }));
    expect(updates[0].patch.answered_at).toBeTruthy();
  });

  it("updates only the call its own callback URL identifies", async () => {
    rows.push({
      ...rows[0],
      id: "call-2",
      bridge_token: "tok-other",
      twilio_call_sid: "CA2",
      lead_id: "lead-2",
    });
    await statusPost(
      post(
        { CallSid: "CA2", CallStatus: "completed", CallDuration: "7" },
        statusUrlFor("tok-other")
      )
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("call-2");
  });

  it("ignores a callback whose SID contradicts the token's own call", async () => {
    // Both halves are real, but they are not the same call. Writing this
    // would stamp one call's outcome onto another.
    await statusPost(post({ CallSid: "CA-somebody-else", CallStatus: "completed" }));
    expect(updates).toHaveLength(0);
    expect(activityInserts).toHaveLength(0);
  });

  it("does nothing for a call it has no record of", async () => {
    await statusPost(
      post({ CallSid: "CA-unknown", CallStatus: "completed" }, statusUrlFor("tok-unknown"))
    );
    expect(updates).toHaveLength(0);
    expect(activityInserts).toHaveLength(0);
  });

  it("still matches on the SID when the callback URL carries no token", async () => {
    await statusPost(
      post(
        { CallSid: "CA1", CallStatus: "completed", CallDuration: "5" },
        "https://app.tweakandbuild.com/api/webhooks/twilio/voice/status"
      )
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("call-1");
  });

  it("ignores a CallStatus it does not recognise", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "teleported" }));
    expect(updates).toHaveLength(0);
  });

  it("never walks a call backwards when events arrive out of order", async () => {
    rows[0].status = "completed";
    await statusPost(post({ CallSid: "CA1", CallStatus: "ringing" }));
    expect(updates).toHaveLength(0);
    expect(rows[0].status).toBe("completed");
  });

  it("does not reopen a terminal call on a duplicate delivery", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "completed", CallDuration: "9" }));
    updates = [];
    await statusPost(post({ CallSid: "CA1", CallStatus: "completed", CallDuration: "9" }));
    expect(updates).toHaveLength(0);
  });

  it("falls back to the token when the SID is not stored yet", async () => {
    rows[0].twilio_call_sid = null;
    await statusPost(post({ CallStatus: "ringing" }));
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("call-1");
  });
});

describe("status — what it must not touch", () => {
  beforeEach(() => {
    process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE = "false";
  });

  function post(params: Record<string, string>) {
    return new NextRequest(statusUrlFor(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
  }

  it("writes only to voice_calls and activity_log", async () => {
    // The fake client throws on any other table, so reaching leads, deals or
    // commission_entries would fail this test rather than pass silently.
    await statusPost(post({ CallSid: "CA1", CallStatus: "completed", CallDuration: "30" }));
    expect(updates).toHaveLength(1);
  });

  it("logs a connected call without claiming a lifecycle change", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "completed", CallDuration: "30" }));
    expect(activityInserts).toHaveLength(1);
    const row = activityInserts[0];
    expect(row.action).toBe("lead.call_connected");
    expect(row).not.toHaveProperty("lifecycle_status");
    expect(row).not.toHaveProperty("contacted_at");
    expect(row).not.toHaveProperty("assigned_to");
  });

  it("does not call a zero-duration completed call connected", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "completed", CallDuration: "0" }));
    expect(activityInserts[0].action).toBe("lead.call_not_connected");
  });

  it("logs a no-answer as not connected", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "no-answer" }));
    expect(activityInserts[0].action).toBe("lead.call_not_connected");
  });

  it("logs nothing on a non-terminal status", async () => {
    await statusPost(post({ CallSid: "CA1", CallStatus: "ringing" }));
    expect(activityInserts).toHaveLength(0);
  });
});
