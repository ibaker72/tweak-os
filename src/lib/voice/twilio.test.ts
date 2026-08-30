import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { twilioCreateCall, TwilioVoiceError } from "./twilio";
import type { VoiceConfig } from "./config";

const CONFIG: VoiceConfig = {
  accountSid: "AC0123456789abcdef",
  authToken: "super-secret-token",
  fromNumber: "+18622984988",
  voiceEnabled: true,
  validateSignature: true,
};

const INPUT = {
  to: "+15550001111",
  from: "+18622984988",
  url: "https://app.tweakandbuild.com/api/webhooks/twilio/voice/bridge?token=abc",
  statusCallback: "https://app.tweakandbuild.com/api/webhooks/twilio/voice/status?token=abc",
};

const originalFetch = global.fetch;

/**
 * Capture the request without ever touching the network.
 *
 * The rest signature is what keeps the recorded calls typed as [url, init];
 * a zero-arg mock collapses them to an empty tuple and the assertions below
 * stop compiling.
 */
function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  const spy = vi.fn(async (...args: [string, RequestInit]) => {
    void args;
    return {
      ok: response.ok,
      status: response.status,
      text: async () => JSON.stringify(response.body),
    };
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

function sentParams(spy: ReturnType<typeof mockFetch>): URLSearchParams {
  return new URLSearchParams(spy.mock.calls[0][1].body as string);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("twilioCreateCall — request shape", () => {
  it("POSTs to the Calls endpoint for the configured account", async () => {
    const spy = mockFetch({ ok: true, status: 201, body: { sid: "CA1", status: "queued" } });
    await twilioCreateCall(CONFIG, INPUT);

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC0123456789abcdef/Calls.json"
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
  });

  it("builds Basic auth from the account SID and the auth token", async () => {
    const spy = mockFetch({ ok: true, status: 201, body: { sid: "CA1", status: "queued" } });
    await twilioCreateCall(CONFIG, INPUT);

    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    const [scheme, encoded] = headers.Authorization.split(" ");
    expect(scheme).toBe("Basic");
    expect(Buffer.from(encoded, "base64").toString()).toBe(
      "AC0123456789abcdef:super-secret-token"
    );
  });

  it("dials the agent first: To is the agent phone, From is the Twilio number", async () => {
    const spy = mockFetch({ ok: true, status: 201, body: { sid: "CA1", status: "queued" } });
    await twilioCreateCall(CONFIG, INPUT);

    const params = sentParams(spy);
    expect(params.get("To")).toBe("+15550001111");
    expect(params.get("From")).toBe("+18622984988");
  });

  it("points Twilio at the bridge and status callbacks", async () => {
    const spy = mockFetch({ ok: true, status: 201, body: { sid: "CA1", status: "queued" } });
    await twilioCreateCall(CONFIG, INPUT);

    const params = sentParams(spy);
    expect(params.get("Url")).toBe(INPUT.url);
    expect(params.get("Method")).toBe("POST");
    expect(params.get("StatusCallback")).toBe(INPUT.statusCallback);
    expect(params.get("StatusCallbackMethod")).toBe("POST");
    expect(params.getAll("StatusCallbackEvent")).toEqual([
      "initiated",
      "ringing",
      "answered",
      "completed",
    ]);
  });

  it("never sends a Record parameter", async () => {
    const spy = mockFetch({ ok: true, status: 201, body: { sid: "CA1", status: "queued" } });
    await twilioCreateCall(CONFIG, INPUT);

    const body = spy.mock.calls[0][1].body as string;
    expect(body).not.toMatch(/Record/);
  });

  it("never puts credentials in the URL", async () => {
    const spy = mockFetch({ ok: true, status: 201, body: { sid: "CA1", status: "queued" } });
    await twilioCreateCall(CONFIG, INPUT);

    const url = spy.mock.calls[0][0];
    expect(url).not.toContain("super-secret-token");
    expect(url).not.toContain("?");
  });

  it("returns the SID and status Twilio assigned", async () => {
    mockFetch({ ok: true, status: 201, body: { sid: "CAabc", status: "queued" } });
    await expect(twilioCreateCall(CONFIG, INPUT)).resolves.toEqual({
      sid: "CAabc",
      status: "queued",
    });
  });
});

describe("twilioCreateCall — refusals", () => {
  it("does not reach the network when credentials are missing", async () => {
    const spy = mockFetch({ ok: true, status: 201, body: {} });
    await expect(
      twilioCreateCall({ ...CONFIG, accountSid: null }, INPUT)
    ).rejects.toThrow(/TWILIO_ACCOUNT_SID/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not reach the network when the caller ID is missing", async () => {
    const spy = mockFetch({ ok: true, status: 201, body: {} });
    await expect(
      twilioCreateCall({ ...CONFIG, fromNumber: null }, INPUT)
    ).rejects.toThrow(/TWILIO_FROM_NUMBER/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces Twilio's own message on an error response", async () => {
    mockFetch({
      ok: false,
      status: 400,
      body: { message: "Account not active", code: 20005 },
    });
    await expect(twilioCreateCall(CONFIG, INPUT)).rejects.toThrow("Account not active");
  });

  it("flags a suspended account as an account problem, not a bad request", async () => {
    // The state the Twilio account is actually in right now.
    mockFetch({
      ok: false,
      status: 403,
      body: { message: "Account suspended", code: 20005 },
    });
    const err = await twilioCreateCall(CONFIG, INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(TwilioVoiceError);
    expect((err as TwilioVoiceError).isAccountProblem).toBe(true);
    expect((err as TwilioVoiceError).twilioCode).toBe(20005);
  });

  it("flags bad credentials as an account problem", async () => {
    mockFetch({
      ok: false,
      status: 401,
      body: { message: "Authenticate", code: 20003 },
    });
    const err = await twilioCreateCall(CONFIG, INPUT).catch((e) => e);
    expect((err as TwilioVoiceError).isAccountProblem).toBe(true);
  });

  it("does not flag an ordinary bad-number rejection as an account problem", async () => {
    mockFetch({
      ok: false,
      status: 400,
      body: { message: "'To' is not a valid phone number", code: 21211 },
    });
    const err = await twilioCreateCall(CONFIG, INPUT).catch((e) => e);
    expect((err as TwilioVoiceError).isAccountProblem).toBe(false);
  });

  it("still reports something useful when the body is not JSON", async () => {
    const spy = vi.fn(async () => ({
      ok: false,
      status: 502,
      text: async () => "<html>bad gateway</html>",
    }));
    global.fetch = spy as unknown as typeof fetch;
    await expect(twilioCreateCall(CONFIG, INPUT)).rejects.toThrow("Twilio API returned 502");
  });
});
