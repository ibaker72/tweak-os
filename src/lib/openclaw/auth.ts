import { NextRequest, NextResponse } from "next/server";

export const OPENCLAW_CAPABILITIES = [
  "leads:list",
  "leads:read",
  "leads:update",
  "leads:notes",
  "leads:enrich",
  "outreach:generate",
  "proposals:create",
] as const;

export type OpenClawAuthOk = { ok: true; token: string };
export type OpenClawAuthFail = { ok: false; response: NextResponse };
export type OpenClawAuthResult = OpenClawAuthOk | OpenClawAuthFail;

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Verifies the incoming request carries a valid OpenClaw bearer token.
 *
 *   - 500 when OPENCLAW_API_TOKEN is unset on the server (misconfigured).
 *   - 401 when the Authorization header is missing or malformed.
 *   - 401 when the bearer token does not match.
 *
 * The comparison is constant-time so the route doesn't leak length/timing.
 */
export function verifyOpenClawAuth(request: NextRequest): OpenClawAuthResult {
  const expected = process.env.OPENCLAW_API_TOKEN;
  if (!expected) {
    console.error("[openclaw] OPENCLAW_API_TOKEN is not set");
    return {
      ok: false,
      response: json(
        { error: "OpenClaw API is not configured on this server." },
        500
      ),
    };
  }

  const header = request.headers.get("authorization");
  if (!header) {
    return {
      ok: false,
      response: json({ error: "Missing Authorization header" }, 401),
    };
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return {
      ok: false,
      response: json(
        { error: "Authorization header must be in the form 'Bearer <token>'" },
        401
      ),
    };
  }

  const provided = match[1].trim();
  if (!constantTimeEqual(provided, expected)) {
    return {
      ok: false,
      response: json({ error: "Invalid OpenClaw API token" }, 401),
    };
  }

  return { ok: true, token: provided };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Lightweight in-process rate limiter. Sufficient for a single-region
 * Next.js deployment; serverless multi-instance setups will allow more
 * requests per minute than the limit but still block runaway clients.
 *
 * Returns null when the request is within the limit, or a NextResponse
 * with status 429 when it exceeds the limit.
 */
export function enforceRateLimit(request: NextRequest): NextResponse | null {
  const key = `${clientIp(request)}|${new URL(request.url).pathname}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.floor(bucket.resetAt / 1000)),
        },
      }
    );
  }

  return null;
}

/**
 * Runs auth + rate limit and returns a usable handle for the route.
 * Routes can short-circuit on `result.response` if present.
 */
export function guard(
  request: NextRequest
): { ok: true } | { ok: false; response: NextResponse } {
  const rate = enforceRateLimit(request);
  if (rate) return { ok: false, response: rate };

  const auth = verifyOpenClawAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  return { ok: true };
}
