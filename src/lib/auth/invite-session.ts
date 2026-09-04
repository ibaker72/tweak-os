/**
 * Accepting an invitation.
 *
 * An invited teammate has a login and an agent_profiles row but no password.
 * The invitation email links to GoTrue's `/auth/v1/verify`, which redirects
 * back to this app carrying a session — and the SDK combination this project
 * pins will not pick that session up on its own:
 *
 *   `@supabase/ssr` 0.9.0 `createBrowserClient()` hard-sets `flowType: "pkce"`
 *   AFTER spreading the caller's `options.auth`, so it cannot be overridden.
 *   `inviteUserByEmail` cannot use PKCE — the browser accepting the invite is
 *   not the browser that sent it, so there is no code verifier anywhere — so
 *   GoTrue redirects with implicit-grant tokens in the URL fragment. auth-js
 *   2.108.1 `_getSessionFromURL()` sees `callbackUrlType === "implicit"` while
 *   `flowType === "pkce"` and throws `Not a valid PKCE flow url.`, leaving the
 *   session unestablished. It does not clear the fragment on that path, which
 *   is what makes reading it here possible.
 *
 * So the fragment is consumed explicitly, with `setSession()`. That call is
 * not a trust decision: it hands the access token to GoTrue, which validates
 * it, and returns no session if it is forged, expired, or already spent.
 *
 * The other arrival shapes are handled too, because a project can change its
 * email template to produce them, and each is a real GoTrue redirect rather
 * than something invented here. What is deliberately absent is a server-side
 * callback route: a URL fragment is never sent to the server, so a server
 * route could not see an invite token at all.
 *
 * Everything here is dependency-injected through `InviteAuthPort` so the whole
 * decision can be exercised without a browser or a Supabase project.
 */

// ---------------------------------------------------------------------------
// What came back on the URL
// ---------------------------------------------------------------------------

export type InviteParams =
  /** GoTrue refused the link: expired, already used, or malformed. */
  | { kind: "error"; code: string; description: string }
  /** Implicit grant — the default for an invitation. */
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  /** PKCE authorization code. */
  | { kind: "code"; code: string }
  /** The `token_hash` shape a customised email template can produce. */
  | { kind: "token_hash"; tokenHash: string; type: string }
  /** Nothing auth-related on the URL at all. */
  | { kind: "none" };

/**
 * Read the parameters off a URL's fragment and query.
 *
 * Query wins over fragment on a collision, matching auth-js's own
 * `parseParametersFromURL`. Takes strings rather than reading `window` so it
 * is testable and so the caller can capture the fragment before anything else
 * has a chance to clear it.
 */
export function parseInviteParams(hash: string, search: string): InviteParams {
  const params = new Map<string, string>();

  const absorb = (raw: string) => {
    const trimmed = raw.replace(/^[#?]/, "");
    if (!trimmed) return;
    for (const [key, value] of new URLSearchParams(trimmed)) params.set(key, value);
  };

  absorb(hash);
  absorb(search);

  const error = params.get("error") ?? params.get("error_code");
  if (error) {
    return {
      kind: "error",
      code: params.get("error_code") ?? params.get("error") ?? "unspecified",
      description: params.get("error_description") ?? "",
    };
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) {
    return { kind: "tokens", accessToken, refreshToken };
  }

  const code = params.get("code");
  if (code) return { kind: "code", code };

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type) return { kind: "token_hash", tokenHash, type };

  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// The slice of the browser auth client this needs
// ---------------------------------------------------------------------------

interface AuthUser {
  email?: string | null;
}
interface AuthSession {
  user?: AuthUser | null;
}
interface AuthFailure {
  message: string;
  code?: string;
  status?: number;
}

/**
 * Structural stand-in for `supabase.auth` on the browser client. Narrow on
 * purpose — nothing here can read a table, and there is no admin namespace.
 */
export interface InviteAuthPort {
  getSession(): Promise<{
    data: { session: AuthSession | null };
    error: AuthFailure | null;
  }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{
    data: { session: AuthSession | null };
    error: AuthFailure | null;
  }>;
  exchangeCodeForSession(code: string): Promise<{
    data: { session: AuthSession | null };
    error: AuthFailure | null;
  }>;
  verifyOtp(params: { token_hash: string; type: string }): Promise<{
    data: { session: AuthSession | null };
    error: AuthFailure | null;
  }>;
  updateUser(attributes: { password: string }): Promise<{
    data: { user: AuthUser | null };
    error: AuthFailure | null;
  }>;
}

// ---------------------------------------------------------------------------
// Establishing the session
// ---------------------------------------------------------------------------

export type InviteSessionResult =
  | { ok: true; email: string | null }
  | { ok: false; reason: "expired" | "invalid" | "missing"; message: string };

const EXPIRED_CODES = new Set([
  "otp_expired",
  "token_expired",
  "expired_token",
  "session_expired",
]);

export const NO_INVITE_MESSAGE =
  "This page needs a valid invitation link. Open the link from your invitation email, or ask an admin to send a new one.";

export const EXPIRED_INVITE_MESSAGE =
  "This invitation link has expired or has already been used. Ask an admin to send a new one.";

export const INVALID_INVITE_MESSAGE =
  "This invitation link could not be verified. Ask an admin to send a new one.";

function describeFailure(code: string): {
  reason: "expired" | "invalid";
  message: string;
} {
  return EXPIRED_CODES.has(code)
    ? { reason: "expired", message: EXPIRED_INVITE_MESSAGE }
    : { reason: "invalid", message: INVALID_INVITE_MESSAGE };
}

/**
 * Turn whatever arrived on the URL into a signed-in session, or into a state
 * the page can explain.
 *
 * The order matters. An error on the URL is decided first — a spent link
 * carries no tokens, and trying anything with it would only produce a worse
 * message. The fragment comes next, because that is the shape an invitation
 * actually arrives in. Only then does it ask the client what it already has,
 * which is also where a PKCE `?code=` gets consumed: `getSession()` awaits the
 * client's own initialization, and a code with a matching verifier is
 * exchanged there. The explicit exchange below is the fallback for when it was
 * not, and it runs second so a code is never spent twice.
 */
export async function establishInviteSession(
  auth: InviteAuthPort,
  params: InviteParams
): Promise<InviteSessionResult> {
  if (params.kind === "error") {
    const { reason, message } = describeFailure(params.code);
    return { ok: false, reason, message };
  }

  if (params.kind === "tokens") {
    // GoTrue validates the token; a forged or expired one yields no session.
    const { data, error } = await auth.setSession({
      access_token: params.accessToken,
      refresh_token: params.refreshToken,
    });
    if (error || !data?.session) {
      const { reason, message } = describeFailure(error?.code ?? "invalid");
      return { ok: false, reason, message };
    }
    return { ok: true, email: data.session.user?.email ?? null };
  }

  const existing = await auth.getSession();
  if (existing.data?.session) {
    return { ok: true, email: existing.data.session.user?.email ?? null };
  }

  if (params.kind === "code") {
    const { data, error } = await auth.exchangeCodeForSession(params.code);
    if (error || !data?.session) {
      const { reason, message } = describeFailure(error?.code ?? "invalid");
      return { ok: false, reason, message };
    }
    return { ok: true, email: data.session.user?.email ?? null };
  }

  if (params.kind === "token_hash") {
    const { data, error } = await auth.verifyOtp({
      token_hash: params.tokenHash,
      type: params.type,
    });
    if (error || !data?.session) {
      const { reason, message } = describeFailure(error?.code ?? "invalid");
      return { ok: false, reason, message };
    }
    return { ok: true, email: data.session.user?.email ?? null };
  }

  // No link, no session. A visitor who simply typed the address lands here,
  // and is never shown the form.
  return { ok: false, reason: "missing", message: NO_INVITE_MESSAGE };
}

// ---------------------------------------------------------------------------
// Choosing the password
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 8;

/**
 * GoTrue hashes with bcrypt, which ignores everything past 72 bytes. Refusing
 * a longer password is honest: silently truncating one means the password the
 * person believes they set is not the password that works.
 */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem = { ok: true } | { ok: false; message: string };

export function validatePassword(password: string, confirmation: string): PasswordProblem {
  if (!password) {
    return { ok: false, message: "Choose a password." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return {
      ok: false,
      message: `That password is too long — keep it under ${PASSWORD_MAX_BYTES} characters.`,
    };
  }
  if (password.trim().length === 0) {
    return { ok: false, message: "A password of only spaces will not work." };
  }
  if (password !== confirmation) {
    return { ok: false, message: "Those passwords do not match." };
  }
  return { ok: true };
}

export type SetPasswordResult =
  | { ok: true }
  | { ok: false; reason: "validation" | "session" | "rejected" | "failed"; message: string };

/**
 * Set the signed-in user's password.
 *
 * Validation runs first and locally, so a mismatch or a short password costs
 * nothing. Then `updateUser` — which acts on the session the client holds and
 * never on an id from the page, so there is no account to name and none to
 * choose. Without a session GoTrue answers with a session error, which is what
 * a visitor with no invitation gets even if they somehow reached the form.
 */
export async function applyNewPassword(
  auth: InviteAuthPort,
  password: string,
  confirmation: string
): Promise<SetPasswordResult> {
  const valid = validatePassword(password, confirmation);
  if (!valid.ok) return { ok: false, reason: "validation", message: valid.message };

  const { data, error } = await auth.updateUser({ password });

  if (error) {
    const code = error.code ?? "";
    if (code === "session_not_found" || code === "session_expired" || error.status === 401) {
      return {
        ok: false,
        reason: "session",
        message:
          "Your invitation session has expired. Open the link from your invitation email again.",
      };
    }
    if (code === "weak_password") {
      return {
        ok: false,
        reason: "rejected",
        message: "That password is too easy to guess. Try a longer one.",
      };
    }
    if (code === "same_password") {
      return {
        ok: false,
        reason: "rejected",
        message: "That is already your password. Choose a different one.",
      };
    }
    return {
      ok: false,
      reason: "failed",
      message: "Could not save your password. Try again.",
    };
  }

  if (!data?.user) {
    return {
      ok: false,
      reason: "failed",
      message: "Could not save your password. Try again.",
    };
  }

  return { ok: true };
}

/** Where a finished setup lands. A fixed path: nothing on the URL steers it. */
export const POST_SETUP_REDIRECT = "/dashboard";
