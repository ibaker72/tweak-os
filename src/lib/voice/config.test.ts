import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isVoiceEnabled,
  readVoiceConfig,
  reconstructWebhookUrl,
  resolveCallbackBaseUrl,
  voiceConfigProblem,
} from "./config";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.TWILIO_VOICE_ENABLED;
  delete process.env.SMS_SENDING_ENABLED;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_FROM_NUMBER;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  delete process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE;
  delete process.env.APP_BASE_URL;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("isVoiceEnabled", () => {
  it("is false when the variable is unset", () => {
    expect(isVoiceEnabled()).toBe(false);
    expect(readVoiceConfig().voiceEnabled).toBe(false);
  });

  it("is true only for the exact string 'true'", () => {
    for (const value of ["false", "1", "yes", "TRUE", "True", " true"]) {
      process.env.TWILIO_VOICE_ENABLED = value;
      expect(isVoiceEnabled(), `${value} must not enable voice`).toBe(false);
    }
    process.env.TWILIO_VOICE_ENABLED = "true";
    expect(isVoiceEnabled()).toBe(true);
  });

  it("is not coupled to SMS_SENDING_ENABLED in either direction", () => {
    // The A2P campaign and voice billing are unrelated events. Turning one on
    // must never turn the other on.
    process.env.SMS_SENDING_ENABLED = "true";
    expect(isVoiceEnabled()).toBe(false);

    process.env.SMS_SENDING_ENABLED = "false";
    process.env.TWILIO_VOICE_ENABLED = "true";
    expect(isVoiceEnabled()).toBe(true);
  });
});

describe("readVoiceConfig", () => {
  it("reads the shared account credentials and the voice caller ID", () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+18622984988";

    const config = readVoiceConfig();
    expect(config.accountSid).toBe("AC123");
    expect(config.authToken).toBe("tok");
    expect(config.fromNumber).toBe("+18622984988");
  });

  it("has no messaging service SID — that is a Messaging API concept", () => {
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG123";
    expect(readVoiceConfig()).not.toHaveProperty("messagingServiceSid");
    expect(JSON.stringify(readVoiceConfig())).not.toContain("MG123");
  });

  it("defaults webhook signature validation to on", () => {
    expect(readVoiceConfig().validateSignature).toBe(true);
    process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE = "false";
    expect(readVoiceConfig().validateSignature).toBe(false);
  });

  it("nulls missing values rather than returning undefined", () => {
    const config = readVoiceConfig();
    expect(config.accountSid).toBeNull();
    expect(config.authToken).toBeNull();
    expect(config.fromNumber).toBeNull();
  });
});

describe("voiceConfigProblem", () => {
  const base = {
    accountSid: "AC123",
    authToken: "tok",
    fromNumber: "+18622984988",
    voiceEnabled: true,
    validateSignature: true,
  };

  it("returns null when everything is present", () => {
    expect(voiceConfigProblem(base)).toBeNull();
  });

  it("names the missing credentials rather than throwing", () => {
    expect(voiceConfigProblem({ ...base, accountSid: null })).toMatch(
      /TWILIO_ACCOUNT_SID/
    );
    expect(voiceConfigProblem({ ...base, authToken: null })).toMatch(/TWILIO_AUTH_TOKEN/);
  });

  it("requires a from number — there is no messaging-service fallback for voice", () => {
    expect(voiceConfigProblem({ ...base, fromNumber: null })).toMatch(
      /TWILIO_FROM_NUMBER/
    );
  });

  it("never echoes the credential values themselves", () => {
    const problem = voiceConfigProblem({ ...base, fromNumber: null });
    expect(problem).not.toContain("AC123");
    expect(problem).not.toContain("tok");
  });
});

describe("resolveCallbackBaseUrl", () => {
  it("prefers an explicit APP_BASE_URL and trims trailing slashes", () => {
    process.env.APP_BASE_URL = "https://app.tweakandbuild.com/";
    const headers = new Headers({ host: "internal-host" });
    expect(resolveCallbackBaseUrl(headers, "http://internal-host/api/voice/call")).toBe(
      "https://app.tweakandbuild.com"
    );
  });

  it("falls back to the forwarded headers, not the internal request host", () => {
    const headers = new Headers({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "app.tweakandbuild.com",
      host: "internal-host",
    });
    expect(resolveCallbackBaseUrl(headers, "http://internal-host/api/voice/call")).toBe(
      "https://app.tweakandbuild.com"
    );
  });

  it("falls back to host when nothing is forwarded", () => {
    const headers = new Headers({ host: "localhost:3000" });
    expect(resolveCallbackBaseUrl(headers, "http://localhost:3000/api/voice/call")).toBe(
      "http://localhost:3000"
    );
  });
});

describe("reconstructWebhookUrl", () => {
  it("rebuilds the URL Twilio actually signed, path and query included", () => {
    const headers = new Headers({
      "x-forwarded-proto": "https",
      "x-forwarded-host": "app.tweakandbuild.com",
      host: "internal-host",
    });
    const url = reconstructWebhookUrl(
      headers,
      "http://internal-host/api/webhooks/twilio/voice/bridge?token=abc123"
    );
    expect(url).toBe(
      "https://app.tweakandbuild.com/api/webhooks/twilio/voice/bridge?token=abc123"
    );
  });

  it("agrees with the callback URL the call was created with", () => {
    // If these two ever disagree, every legitimate webhook fails its signature
    // check — so they are asserted against each other rather than separately.
    process.env.APP_BASE_URL = "https://app.tweakandbuild.com";
    const headers = new Headers({ host: "internal-host" });
    const base = resolveCallbackBaseUrl(headers, "http://internal-host/x");
    expect(
      reconstructWebhookUrl(
        headers,
        "http://internal-host/api/webhooks/twilio/voice/status?token=t"
      )
    ).toBe(`${base}/api/webhooks/twilio/voice/status?token=t`);
  });
});
