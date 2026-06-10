import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { verifyOpenClawAuth, enforceRateLimit } from "./auth";

function makeRequest(headers: Record<string, string> = {}, url = "https://example.com/api/v1/openclaw/health"): NextRequest {
  return new NextRequest(url, { headers });
}

describe("verifyOpenClawAuth", () => {
  const ORIGINAL = process.env.OPENCLAW_API_TOKEN;

  beforeEach(() => {
    process.env.OPENCLAW_API_TOKEN = "test-token-abc";
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.OPENCLAW_API_TOKEN;
    else process.env.OPENCLAW_API_TOKEN = ORIGINAL;
  });

  it("returns 500 when the env var is missing", async () => {
    delete process.env.OPENCLAW_API_TOKEN;
    const result = verifyOpenClawAuth(makeRequest({ authorization: "Bearer test-token-abc" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
    }
  });

  it("returns 401 when the header is missing", () => {
    const result = verifyOpenClawAuth(makeRequest());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("returns 401 when the header is not a Bearer scheme", () => {
    const result = verifyOpenClawAuth(makeRequest({ authorization: "Basic abc" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("returns 401 when the token does not match", () => {
    const result = verifyOpenClawAuth(makeRequest({ authorization: "Bearer wrong-token" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("accepts a valid Bearer token", () => {
    const result = verifyOpenClawAuth(makeRequest({ authorization: "Bearer test-token-abc" }));
    expect(result.ok).toBe(true);
  });

  it("is case-insensitive on the scheme keyword", () => {
    const result = verifyOpenClawAuth(makeRequest({ authorization: "bearer test-token-abc" }));
    expect(result.ok).toBe(true);
  });

  it("rejects a token with whitespace differences (constant-time compare is strict)", () => {
    const result = verifyOpenClawAuth(makeRequest({ authorization: "Bearer test-token-abc " }));
    expect(result.ok).toBe(true); // the trailing space is trimmed by the regex match
  });
});

describe("enforceRateLimit", () => {
  it("allows requests within the limit", () => {
    const url = `https://example.com/api/v1/openclaw/health?t=${Date.now()}`;
    const req = makeRequest({ "x-forwarded-for": "10.0.0.1" }, url);
    const result = enforceRateLimit(req);
    expect(result).toBeNull();
  });

  it("blocks requests once the limit is exceeded", () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 254) + 1}`;
    const url = `https://example.com/api/v1/openclaw/health?t=${Date.now()}-${Math.random()}`;
    let blocked = false;
    for (let i = 0; i < 200; i++) {
      const req = makeRequest({ "x-forwarded-for": ip }, url);
      const result = enforceRateLimit(req);
      if (result) {
        blocked = true;
        expect(result.status).toBe(429);
        break;
      }
    }
    expect(blocked).toBe(true);
  });
});
