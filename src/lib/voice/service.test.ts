import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mock the Twilio helper so a wandering call would be loud rather than silent.
// The disabled-path tests assert this spy is NEVER called.
const twilioCreateCall = vi.fn();
class FakeTwilioVoiceError extends Error {
  isAccountProblem: boolean;
  constructor(message: string, accountProblem = false) {
    super(message);
    this.isAccountProblem = accountProblem;
  }
}
vi.mock("./twilio", () => ({
  twilioCreateCall: (...args: unknown[]) => twilioCreateCall(...args),
  TwilioVoiceError: FakeTwilioVoiceError,
}));

const { initiateVoiceCall, bridgeUrl, statusCallbackUrl } = await import("./service");

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

/**
 * A Supabase stand-in that records every rpc() and replies from a script.
 * Nothing else is reachable — a stray .from() would throw.
 */
function makeSupabase(requestResult: Record<string, unknown>) {
  const calls: RpcCall[] = [];
  const client = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === "request_voice_call") return { data: requestResult, error: null };
      if (fn === "record_voice_call_result") {
        return { data: { ok: true }, error: null };
      }
      throw new Error(`Unexpected rpc: ${fn}`);
    },
    from() {
      throw new Error("initiateVoiceCall must not touch tables directly");
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const OK_REQUEST = {
  ok: true,
  call_id: "call-1",
  lead_id: "lead-1",
  agent_id: "agent-1",
  business_name: "Acme HVAC",
  bridge_token: "tok-abc",
  agent_phone: "+15550001111",
  prospect_phone: "+19735551234",
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  twilioCreateCall.mockReset();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.TWILIO_VOICE_ENABLED;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function enableVoice() {
  process.env.TWILIO_VOICE_ENABLED = "true";
  process.env.TWILIO_ACCOUNT_SID = "AC123";
  process.env.TWILIO_AUTH_TOKEN = "tok";
  process.env.TWILIO_FROM_NUMBER = "+18622984988";
}

const INPUT = { leadId: "lead-1", baseUrl: "https://app.tweakandbuild.com" };

describe("the server decides who gets dialed", () => {
  it("passes the lead id and nothing else to request_voice_call", async () => {
    enableVoice();
    twilioCreateCall.mockResolvedValue({ sid: "CA1", status: "queued" });
    const { client, calls } = makeSupabase(OK_REQUEST);

    await initiateVoiceCall(client, INPUT);

    const request = calls.find((c) => c.fn === "request_voice_call");
    expect(request?.args).toEqual({ p_lead_id: "lead-1" });
    // No parameter exists for any of these, so none can be forged.
    expect(Object.keys(request?.args ?? {})).not.toContain("p_agent_id");
    expect(Object.keys(request?.args ?? {})).not.toContain("p_prospect_phone");
    expect(Object.keys(request?.args ?? {})).not.toContain("p_from_number");
  });

  it("dials the numbers the database returned, not anything the caller passed", async () => {
    enableVoice();
    twilioCreateCall.mockResolvedValue({ sid: "CA1", status: "queued" });
    const { client } = makeSupabase(OK_REQUEST);

    await initiateVoiceCall(client, {
      ...INPUT,
      // Extra keys are not part of the input type; even smuggled in at
      // runtime they reach nothing.
      ...({ prospectPhone: "+19999999999", from: "+16660000000" } as object),
    });

    const [, callArgs] = twilioCreateCall.mock.calls[0];
    expect(callArgs.to).toBe("+15550001111");
    expect(callArgs.from).toBe("+18622984988");
    expect(JSON.stringify(callArgs)).not.toContain("+19999999999");
    expect(JSON.stringify(callArgs)).not.toContain("+16660000000");
  });

  it("builds the callback URLs from the call's own token", async () => {
    enableVoice();
    twilioCreateCall.mockResolvedValue({ sid: "CA1", status: "queued" });
    const { client } = makeSupabase(OK_REQUEST);

    await initiateVoiceCall(client, INPUT);

    const [, callArgs] = twilioCreateCall.mock.calls[0];
    expect(callArgs.url).toBe(
      "https://app.tweakandbuild.com/api/webhooks/twilio/voice/bridge?token=tok-abc"
    );
    expect(callArgs.statusCallback).toBe(
      "https://app.tweakandbuild.com/api/webhooks/twilio/voice/status?token=tok-abc"
    );
    // The prospect's number never appears in a URL.
    expect(callArgs.url).not.toContain("9735551234");
    expect(callArgs.statusCallback).not.toContain("9735551234");
  });

  it("records the Twilio SID against the call record", async () => {
    enableVoice();
    twilioCreateCall.mockResolvedValue({ sid: "CAxyz", status: "queued" });
    const { client, calls } = makeSupabase(OK_REQUEST);

    const result = await initiateVoiceCall(client, INPUT);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("calling");
    expect(result.twilio_call_sid).toBe("CAxyz");
    const record = calls.find((c) => c.fn === "record_voice_call_result");
    expect(record?.args).toMatchObject({
      p_call_id: "call-1",
      p_status: "initiated",
      p_twilio_call_sid: "CAxyz",
      p_from_number: "+18622984988",
    });
  });

  it("says the phone is ringing, not that the prospect was reached", async () => {
    enableVoice();
    twilioCreateCall.mockResolvedValue({ sid: "CA1", status: "queued" });
    const { client } = makeSupabase(OK_REQUEST);

    const result = await initiateVoiceCall(client, INPUT);
    expect(result.message).toMatch(/Calling your phone/);
    expect(result.message).not.toMatch(/completed|connected|contacted/i);
  });
});

describe("the kill switch", () => {
  it("never contacts Twilio when TWILIO_VOICE_ENABLED is unset", async () => {
    const { client, calls } = makeSupabase(OK_REQUEST);

    const result = await initiateVoiceCall(client, INPUT);

    expect(twilioCreateCall).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("disabled");
    expect(result.message).toBe(
      "Twilio Voice is currently disabled. The call was not placed."
    );
    expect(calls.find((c) => c.fn === "record_voice_call_result")?.args).toMatchObject({
      p_call_id: "call-1",
      p_status: "disabled",
    });
  });

  it("never contacts Twilio when the flag is any value other than 'true'", async () => {
    for (const value of ["false", "1", "TRUE"]) {
      twilioCreateCall.mockReset();
      process.env.TWILIO_VOICE_ENABLED = value;
      const { client } = makeSupabase(OK_REQUEST);
      const result = await initiateVoiceCall(client, INPUT);
      expect(twilioCreateCall).not.toHaveBeenCalled();
      expect(result.reason).toBe("disabled");
    }
  });

  it("still logs the attempt, so a disabled call is visible in the history", async () => {
    const { client, calls } = makeSupabase(OK_REQUEST);
    await initiateVoiceCall(client, INPUT);
    expect(calls.map((c) => c.fn)).toEqual([
      "request_voice_call",
      "record_voice_call_result",
    ]);
  });

  it("is not enabled by SMS_SENDING_ENABLED", async () => {
    process.env.SMS_SENDING_ENABLED = "true";
    const { client } = makeSupabase(OK_REQUEST);
    const result = await initiateVoiceCall(client, INPUT);
    expect(twilioCreateCall).not.toHaveBeenCalled();
    expect(result.reason).toBe("disabled");
  });
});

describe("refusals from the database", () => {
  const cases = [
    ["lead_not_found", "Lead not found or not assigned to you."],
    ["lead_do_not_contact", "This lead is marked do-not-contact."],
    ["agent_phone_missing", "Add your callback phone number before using Twilio calling."],
    ["lead_phone_missing", "This lead has no valid phone number to call."],
    ["same_number", "This lead's number is your own callback number."],
  ] as const;

  for (const [reason, message] of cases) {
    it(`${reason} is reported without contacting Twilio`, async () => {
      enableVoice();
      const { client, calls } = makeSupabase({ ok: false, reason });

      const result = await initiateVoiceCall(client, INPUT);

      expect(twilioCreateCall).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(reason);
      expect(result.message).toBe(message);
      // No record was created, so there is nothing to close out.
      expect(calls.some((c) => c.fn === "record_voice_call_result")).toBe(false);
    });
  }

  it("treats an unknown refusal as not-found rather than proceeding", async () => {
    enableVoice();
    const { client } = makeSupabase({ ok: false, reason: "something_new" });
    const result = await initiateVoiceCall(client, INPUT);
    expect(twilioCreateCall).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});

describe("Twilio errors", () => {
  it("marks the call failed and keeps Twilio's own words", async () => {
    enableVoice();
    twilioCreateCall.mockRejectedValue(
      new FakeTwilioVoiceError("Account suspended", true)
    );
    const { client, calls } = makeSupabase(OK_REQUEST);

    const result = await initiateVoiceCall(client, INPUT);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("twilio_error");
    expect(result.error_message).toBe("Account suspended");
    expect(result.message).toMatch(/cannot place calls right now/);

    const record = calls.find((c) => c.fn === "record_voice_call_result");
    expect(record?.args).toMatchObject({
      p_call_id: "call-1",
      p_status: "failed",
      p_error_message: "Account suspended",
    });
  });

  it("never records an accepted-then-failed request as completed", async () => {
    enableVoice();
    twilioCreateCall.mockRejectedValue(new Error("boom"));
    const { client, calls } = makeSupabase(OK_REQUEST);

    await initiateVoiceCall(client, INPUT);

    const statuses = calls
      .filter((c) => c.fn === "record_voice_call_result")
      .map((c) => c.args.p_status);
    expect(statuses).toEqual(["failed"]);
    expect(statuses).not.toContain("completed");
  });

  it("reports a plain failure differently from an account problem", async () => {
    enableVoice();
    twilioCreateCall.mockRejectedValue(new FakeTwilioVoiceError("Invalid number", false));
    const { client } = makeSupabase(OK_REQUEST);
    const result = await initiateVoiceCall(client, INPUT);
    expect(result.message).toBe("Twilio could not place the call.");
    expect(result.error_message).toBe("Invalid number");
  });
});

describe("enabled but not configured", () => {
  it("refuses an origin Twilio cannot fetch TwiML from", async () => {
    // A call placed from `npm run dev` would ring the agent's phone and then
    // go silent, because Twilio cannot reach localhost. Saying so up front is
    // cheaper than reading it out of a Twilio error log afterwards.
    enableVoice();
    const { client } = makeSupabase(OK_REQUEST);

    const result = await initiateVoiceCall(client, {
      leadId: "lead-1",
      baseUrl: "http://localhost:3000",
    });

    expect(twilioCreateCall).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_configured");
    expect(result.error_message).toMatch(/APP_BASE_URL/);
  });

  it("still records the attempt when the callback origin is unusable", async () => {
    enableVoice();
    const { client, calls } = makeSupabase(OK_REQUEST);
    await initiateVoiceCall(client, { leadId: "lead-1", baseUrl: "http://127.0.0.1:3000" });

    const recorded = calls.find((c) => c.fn === "record_voice_call_result");
    expect(recorded?.args.p_status).toBe("failed");
  });

  it("places the call from a public origin", async () => {
    enableVoice();
    twilioCreateCall.mockResolvedValue({ sid: "CA1", status: "queued" });
    const { client } = makeSupabase(OK_REQUEST);

    const result = await initiateVoiceCall(client, INPUT);
    expect(result.ok).toBe(true);
    expect(twilioCreateCall).toHaveBeenCalledTimes(1);
  });

  it("fails the call rather than calling Twilio with half a config", async () => {
    process.env.TWILIO_VOICE_ENABLED = "true";
    // No SID, token or from number.
    const { client, calls } = makeSupabase(OK_REQUEST);

    const result = await initiateVoiceCall(client, INPUT);

    expect(twilioCreateCall).not.toHaveBeenCalled();
    expect(result.reason).toBe("not_configured");
    expect(result.error_message).toMatch(/TWILIO_ACCOUNT_SID/);
    expect(calls.find((c) => c.fn === "record_voice_call_result")?.args).toMatchObject({
      p_status: "failed",
    });
  });
});

describe("callback URL builders", () => {
  it("tolerate a base URL with a trailing slash", () => {
    expect(bridgeUrl("https://x.dev/", "t")).toBe(
      "https://x.dev/api/webhooks/twilio/voice/bridge?token=t"
    );
    expect(statusCallbackUrl("https://x.dev/", "t")).toBe(
      "https://x.dev/api/webhooks/twilio/voice/status?token=t"
    );
  });

  it("url-encode the token", () => {
    expect(bridgeUrl("https://x.dev", "a b&c")).toContain("token=a%20b%26c");
  });
});
