import { describe, it, expect, vi } from "vitest";
import {
  applyNewPassword,
  establishInviteSession,
  EXPIRED_INVITE_MESSAGE,
  INVALID_INVITE_MESSAGE,
  NO_INVITE_MESSAGE,
  parseInviteParams,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  POST_SETUP_REDIRECT,
  validatePassword,
  type InviteAuthPort,
} from "./invite-session";

/**
 * Accepting an invitation, against a fake auth client.
 *
 * The properties that matter: an invited person with a real link can set a
 * password, a visitor without one is never shown the form and cannot set
 * anybody's password, and a spent link says so rather than showing a blank
 * screen.
 */

const SESSION = { user: { email: "mary@example.com" } };

function fakeAuth(overrides: Partial<Record<keyof InviteAuthPort, unknown>> = {}) {
  const port = {
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    setSession: vi.fn(async () => ({ data: { session: SESSION }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session: SESSION }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { session: SESSION }, error: null })),
    updateUser: vi.fn(async () => ({ data: { user: SESSION.user }, error: null })),
    ...overrides,
  };
  return port as unknown as InviteAuthPort & typeof port;
}

// ---------------------------------------------------------------------------

describe("reading what the invitation link came back with", () => {
  /**
   * The shape an invitation actually arrives in: GoTrue's /auth/v1/verify
   * redirects with an implicit grant, tokens in the fragment.
   */
  it("reads implicit-grant tokens out of the fragment", () => {
    const hash =
      "#access_token=eyJhbGc.abc&expires_in=3600&refresh_token=r-123" +
      "&token_type=bearer&type=invite";
    expect(parseInviteParams(hash, "")).toEqual({
      kind: "tokens",
      accessToken: "eyJhbGc.abc",
      refreshToken: "r-123",
    });
  });

  it("reads a spent or expired link's error, with its code", () => {
    const hash =
      "#error=access_denied&error_code=otp_expired" +
      "&error_description=Email+link+is+invalid+or+has+expired";
    expect(parseInviteParams(hash, "")).toEqual({
      kind: "error",
      code: "otp_expired",
      description: "Email link is invalid or has expired",
    });
  });

  it("reads an error delivered on the query string too", () => {
    const parsed = parseInviteParams("", "?error=server_error&error_code=unexpected_failure");
    expect(parsed).toMatchObject({ kind: "error", code: "unexpected_failure" });
  });

  it("reads a PKCE code and a token_hash link", () => {
    expect(parseInviteParams("", "?code=abc-123")).toEqual({ kind: "code", code: "abc-123" });
    expect(parseInviteParams("", "?token_hash=pkce_hash&type=invite")).toEqual({
      kind: "token_hash",
      tokenHash: "pkce_hash",
      type: "invite",
    });
  });

  it("reports nothing for a bare visit", () => {
    expect(parseInviteParams("", "")).toEqual({ kind: "none" });
    expect(parseInviteParams("#", "?")).toEqual({ kind: "none" });
    expect(parseInviteParams("#not-a-query-string", "")).toEqual({ kind: "none" });
  });

  it("ignores half a token pair rather than guessing", () => {
    expect(parseInviteParams("#access_token=abc&token_type=bearer", "")).toEqual({
      kind: "none",
    });
  });

  it("lets the query win a collision, as the SDK does", () => {
    const parsed = parseInviteParams("#code=from-hash", "?code=from-query");
    expect(parsed).toEqual({ kind: "code", code: "from-query" });
  });
});

// ---------------------------------------------------------------------------

describe("establishing the invited session", () => {
  it("signs the invitee in from the fragment tokens", async () => {
    const auth = fakeAuth();
    const result = await establishInviteSession(auth, {
      kind: "tokens",
      accessToken: "a",
      refreshToken: "r",
    });

    expect(result).toEqual({ ok: true, email: "mary@example.com" });
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: "a",
      refresh_token: "r",
    });
  });

  /**
   * The requirement that matters most here: somebody who simply types the
   * address must not reach the form.
   */
  it("refuses a visitor with no link and no session", async () => {
    const auth = fakeAuth();
    const result = await establishInviteSession(auth, { kind: "none" });

    expect(result).toEqual({ ok: false, reason: "missing", message: NO_INVITE_MESSAGE });
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("explains an expired link instead of showing a blank screen", async () => {
    for (const code of ["otp_expired", "token_expired", "session_expired"]) {
      const result = await establishInviteSession(fakeAuth(), {
        kind: "error",
        code,
        description: "Email link is invalid or has expired",
      });
      expect(result).toEqual({
        ok: false,
        reason: "expired",
        message: EXPIRED_INVITE_MESSAGE,
      });
    }
  });

  it("explains an otherwise-broken link", async () => {
    const result = await establishInviteSession(fakeAuth(), {
      kind: "error",
      code: "unexpected_failure",
      description: "Database error",
    });
    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      message: INVALID_INVITE_MESSAGE,
    });
    // GoTrue's own wording is not passed through to the invitee.
    expect(result).not.toMatchObject({ message: expect.stringContaining("Database") });
  });

  it("does nothing with a link GoTrue already rejected", async () => {
    const auth = fakeAuth();
    await establishInviteSession(auth, { kind: "error", code: "otp_expired", description: "" });
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("treats a token the server refuses as an unusable link", async () => {
    const auth = fakeAuth({
      setSession: vi.fn(async () => ({
        data: { session: null },
        error: { message: "invalid claim: missing sub", status: 401 },
      })),
    });
    const result = await establishInviteSession(auth, {
      kind: "tokens",
      accessToken: "forged",
      refreshToken: "forged",
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    // The forged token's own error text stays out of the message.
    expect(JSON.stringify(result)).not.toMatch(/invalid claim|missing sub/);
  });

  it("uses the session the client already established", async () => {
    // What a PKCE `?code=` produces: the client's own initialization consumed
    // it, so getSession already has the answer.
    const auth = fakeAuth({
      getSession: vi.fn(async () => ({ data: { session: SESSION }, error: null })),
    });
    const result = await establishInviteSession(auth, { kind: "code", code: "abc" });

    expect(result).toEqual({ ok: true, email: "mary@example.com" });
    // And the code is not spent a second time.
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("exchanges a code the client did not consume", async () => {
    const auth = fakeAuth();
    const result = await establishInviteSession(auth, { kind: "code", code: "abc" });

    expect(result).toEqual({ ok: true, email: "mary@example.com" });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("verifies a token_hash link", async () => {
    const auth = fakeAuth();
    const result = await establishInviteSession(auth, {
      kind: "token_hash",
      tokenHash: "h",
      type: "invite",
    });

    expect(result).toEqual({ ok: true, email: "mary@example.com" });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "invite" });
  });

  it("lets an already-signed-in visitor through without a link", async () => {
    // Somebody who reloads the page after the fragment was cleared.
    const auth = fakeAuth({
      getSession: vi.fn(async () => ({ data: { session: SESSION }, error: null })),
    });
    expect(await establishInviteSession(auth, { kind: "none" })).toEqual({
      ok: true,
      email: "mary@example.com",
    });
  });
});

// ---------------------------------------------------------------------------

describe("password rules", () => {
  it("accepts a reasonable password typed twice", () => {
    expect(validatePassword("correct horse battery", "correct horse battery")).toEqual({
      ok: true,
    });
  });

  it("rejects a mismatch", () => {
    expect(validatePassword("hunter2hunter2", "hunter2hunter3")).toEqual({
      ok: false,
      message: "Those passwords do not match.",
    });
  });

  it("rejects an empty or short password", () => {
    expect(validatePassword("", "")).toMatchObject({ ok: false });
    expect(validatePassword("short", "short")).toEqual({
      ok: false,
      message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    });
  });

  it("rejects whitespace masquerading as a password", () => {
    expect(validatePassword("        ", "        ")).toMatchObject({ ok: false });
  });

  /**
   * bcrypt ignores everything past 72 bytes, so a longer password would not be
   * the password that works. Refusing it beats truncating it silently.
   */
  it("rejects a password bcrypt would truncate, counting bytes not characters", () => {
    const long = "a".repeat(PASSWORD_MAX_BYTES + 1);
    expect(validatePassword(long, long)).toMatchObject({ ok: false });

    // 24 emoji is 96 bytes but only 24 characters.
    const emoji = "🔒".repeat(24);
    expect(validatePassword(emoji, emoji)).toMatchObject({ ok: false });

    const atLimit = "a".repeat(PASSWORD_MAX_BYTES);
    expect(validatePassword(atLimit, atLimit)).toEqual({ ok: true });
  });
});

describe("setting the password", () => {
  it("updates the signed-in user and names no account", async () => {
    const auth = fakeAuth();
    expect(await applyNewPassword(auth, "a-good-password", "a-good-password")).toEqual({
      ok: true,
    });

    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    const [attributes] = vi.mocked(auth.updateUser).mock.calls[0];
    // The session decides whose password this is. There is no id to pass and
    // none is passed.
    expect(Object.keys(attributes)).toEqual(["password"]);
  });

  it("rejects a mismatch without calling Supabase at all", async () => {
    const auth = fakeAuth();
    const result = await applyNewPassword(auth, "a-good-password", "a-typo-password");

    expect(result).toEqual({
      ok: false,
      reason: "validation",
      message: "Those passwords do not match.",
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a short password without calling Supabase", async () => {
    const auth = fakeAuth();
    expect(await applyNewPassword(auth, "abc", "abc")).toMatchObject({
      reason: "validation",
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  /**
   * The backstop behind the page: even if somebody forced the form open, the
   * password change acts on a session they do not have.
   */
  it("cannot set a password without a session", async () => {
    const auth = fakeAuth({
      updateUser: vi.fn(async () => ({
        data: { user: null },
        error: { message: "Auth session missing!", code: "session_not_found", status: 401 },
      })),
    });
    const result = await applyNewPassword(auth, "a-good-password", "a-good-password");

    expect(result).toMatchObject({ ok: false, reason: "session" });
    expect(result).toMatchObject({ message: expect.stringMatching(/invitation session/i) });
  });

  it("passes on a weak-password refusal in plain words", async () => {
    const auth = fakeAuth({
      updateUser: vi.fn(async () => ({
        data: { user: null },
        error: { message: "Password is known to be weak", code: "weak_password", status: 422 },
      })),
    });
    expect(await applyNewPassword(auth, "password1234", "password1234")).toMatchObject({
      ok: false,
      reason: "rejected",
    });
  });

  it("reports any other failure without echoing the server's text", async () => {
    const auth = fakeAuth({
      updateUser: vi.fn(async () => ({
        data: { user: null },
        error: { message: "pgbouncer: connection pool exhausted", status: 500 },
      })),
    });
    const result = await applyNewPassword(auth, "a-good-password", "a-good-password");

    expect(result).toEqual({
      ok: false,
      reason: "failed",
      message: "Could not save your password. Try again.",
    });
    expect(JSON.stringify(result)).not.toMatch(/pgbouncer/);
  });

  it("never puts the password in its own result", async () => {
    const auth = fakeAuth({
      updateUser: vi.fn(async () => ({
        data: { user: null },
        error: { message: "nope", status: 500 },
      })),
    });
    const secret = "correct-horse-battery-staple";
    const result = await applyNewPassword(auth, secret, secret);
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe("where setup finishes", () => {
  it("is a fixed path, not something a URL can steer", () => {
    expect(POST_SETUP_REDIRECT).toBe("/dashboard");
  });
});
