import { z } from "zod";

/**
 * Onboarding a teammate: turning a name and an email into a login and an
 * agent_profiles row.
 *
 * Two systems have to agree for someone to be able to use the app. Supabase
 * Auth owns the login (auth.users); public.agent_profiles owns everything the
 * app authorises on — role, active flag, commission rate, assignment. Neither
 * one alone gets anybody in: a login with no profile is refused by
 * requireUser(), and a profile with no login has nothing to sign in with.
 *
 * The admin UI only ever had half of it. It posted a display name and an email
 * to a route that required a `user_id` nobody could supply from the browser,
 * so the request 400'd and the button did nothing. The missing half is here:
 * resolve or create the auth user first, then let the route write the profile
 * under the caller's own session.
 *
 * Everything in this file is dependency-injected through `AdminAuthPort` so it
 * can be exercised against a fake rather than a real Supabase project.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Store and compare emails in one shape.
 *
 * "Mary@Example.com " and "mary@example.com" are the same person to GoTrue,
 * which lowercases on signup. If the profile kept the typed casing, the
 * duplicate check below — and every later "is this the same teammate" question
 * — would answer wrongly for anybody who capitalised their own name.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * What an admin is allowed to post.
 *
 * Strict on purpose. `user_id` used to be a required field here, which meant a
 * client could name any auth user — including one that is not the person whose
 * email is in the body — and have a profile written against it. Onboarding now
 * derives the user id server-side from the email, and an unrecognised key is a
 * 400 rather than something quietly dropped. `role` is not accepted either:
 * every invite lands as an agent, and promoting one is a separate, deliberate
 * PATCH.
 */
export const inviteAgentSchema = z.strictObject({
  display_name: z
    .string()
    .trim()
    .min(1, "Enter the agent's name")
    .max(120, "Name is too long"),
  email: z
    .string()
    .transform(normalizeEmail)
    .pipe(z.email("Enter a valid email address").max(254, "Email is too long")),
});

export type InviteAgentInput = z.infer<typeof inviteAgentSchema>;

// ---------------------------------------------------------------------------
// The slice of the Supabase Auth Admin API this needs
// ---------------------------------------------------------------------------

interface AdminAuthUser {
  id: string;
  email?: string | null;
}

interface AdminAuthError {
  message: string;
  code?: string;
  status?: number;
}

/**
 * Structural stand-in for `supabase.auth.admin`. Narrow by design: a lookup
 * and an invite, no user deletion and no table access.
 */
export interface AdminAuthPort {
  listUsers(params?: { page?: number; perPage?: number }): Promise<{
    data: { users: AdminAuthUser[] };
    error: AdminAuthError | null;
  }>;
  inviteUserByEmail(
    email: string,
    options?: { data?: object; redirectTo?: string }
  ): Promise<{
    data: { user: AdminAuthUser | null };
    error: AdminAuthError | null;
  }>;
}

// ---------------------------------------------------------------------------
// Finding an existing login
// ---------------------------------------------------------------------------

/**
 * GoTrue's admin API in this SDK version exposes no "get user by email" — only
 * a paginated list. So the lookup is a bounded scan: 200 at a time, up to
 * 5,000 users, which is several orders of magnitude more than an internal
 * sales team will ever have.
 *
 * Bounded rather than unbounded because an unbounded loop over a large project
 * is a slow request an admin can trigger by typing an unknown address. When
 * the scan runs out without a match the caller does not conclude "no such
 * user" and stop — it still tries the invite, and GoTrue's own uniqueness
 * check on auth.users is what actually decides.
 */
export const LOOKUP_PAGE_SIZE = 200;
export const LOOKUP_MAX_PAGES = 25;

export type LookupResult =
  | { ok: true; user: AdminAuthUser | null; exhausted: boolean }
  | { ok: false; detail: string };

export async function findAuthUserByEmail(
  admin: AdminAuthPort,
  email: string
): Promise<LookupResult> {
  const target = normalizeEmail(email);

  for (let page = 1; page <= LOOKUP_MAX_PAGES; page++) {
    const { data, error } = await admin.listUsers({
      page,
      perPage: LOOKUP_PAGE_SIZE,
    });

    if (error) return { ok: false, detail: error.message };

    const users = data?.users ?? [];
    const match = users.find((u) => normalizeEmail(u.email ?? "") === target);
    if (match) return { ok: true, user: match, exhausted: false };

    // A short page is the last page.
    if (users.length < LOOKUP_PAGE_SIZE) {
      return { ok: true, user: null, exhausted: false };
    }
  }

  // Ran to the bound with no match: absence is not established.
  return { ok: true, user: null, exhausted: true };
}

/**
 * Whether GoTrue is saying "that email already has a login".
 *
 * Worth recognising precisely: it is the difference between "link the person
 * who is already here" and "the invite failed, tell the admin". The code
 * field is the modern signal; older deployments only carry the message, and
 * the 422 is what both have in common.
 */
export function isEmailAlreadyRegistered(error: AdminAuthError): boolean {
  if (error.code === "email_exists" || error.code === "user_already_exists") {
    return true;
  }
  return (
    error.status === 422 &&
    /already[\s_-]*(been\s+)?(registered|exists)|email[\s_-]*exists|user[\s_-]*already/i.test(
      error.message ?? ""
    )
  );
}

// ---------------------------------------------------------------------------
// Resolve or invite
// ---------------------------------------------------------------------------

export type ResolveAuthUserResult =
  | { ok: true; userId: string; invited: boolean }
  /** The lookup itself failed — nothing was created, retrying is free. */
  | { ok: false; code: "lookup_failed"; detail: string }
  /** GoTrue refused the invite for a reason other than "already exists". */
  | { ok: false; code: "invite_failed"; detail: string }
  /**
   * The email has a login, but the bounded scan could not find which one.
   * Nothing was created; the profile has to be linked by hand.
   */
  | { ok: false; code: "existing_user_unresolvable"; detail: string };

/**
 * Get the auth.users id for an email, inviting the person if they are new.
 *
 * Lookup first, invite second — an existing teammate must not be sent a second
 * invitation, and GoTrue would refuse it anyway. The invite path is only ever
 * reached for an address with no login.
 *
 * Idempotent by construction, which is what makes a retry after a half-failed
 * onboarding safe: run it twice for the same address and the second run finds
 * the user the first run invited and reports `invited: false`. It never
 * deletes an auth user to clean up — a login that exists is somebody's, and
 * the recovery for a failed profile write is to link it, not to destroy the
 * account and any session already attached to it.
 */
export async function resolveOrInviteAuthUser(
  admin: AdminAuthPort,
  input: { email: string; displayName: string; redirectTo?: string | null }
): Promise<ResolveAuthUserResult> {
  const email = normalizeEmail(input.email);

  const found = await findAuthUserByEmail(admin, email);
  if (!found.ok) return { ok: false, code: "lookup_failed", detail: found.detail };
  if (found.user) return { ok: true, userId: found.user.id, invited: false };

  const { data, error } = await admin.inviteUserByEmail(email, {
    data: { display_name: input.displayName },
    // Omitted rather than guessed when the app origin is not configured:
    // GoTrue then falls back to the project's own Site URL, which is a real
    // configured value. A made-up path would send the invitee to a 404.
    ...(input.redirectTo ? { redirectTo: input.redirectTo } : {}),
  });

  if (error) {
    if (!isEmailAlreadyRegistered(error)) {
      return { ok: false, code: "invite_failed", detail: error.message };
    }

    // Two ways to land here: the address was created between the lookup and
    // the invite (two admins, or a double-click), or it lives past the scan
    // bound. Look again before giving up — the first case is the common one
    // and resolves cleanly into a link.
    const retry = await findAuthUserByEmail(admin, email);
    if (!retry.ok) return { ok: false, code: "lookup_failed", detail: retry.detail };
    if (retry.user) return { ok: true, userId: retry.user.id, invited: false };

    return {
      ok: false,
      code: "existing_user_unresolvable",
      detail: error.message,
    };
  }

  const user = data?.user;
  if (!user?.id) {
    return {
      ok: false,
      code: "invite_failed",
      detail: "Supabase accepted the invitation but returned no user",
    };
  }

  return { ok: true, userId: user.id, invited: true };
}

// ---------------------------------------------------------------------------
// Where the invitation link lands
// ---------------------------------------------------------------------------

/**
 * The only page in this app an invited person can usefully arrive on.
 *
 * There is no /auth/callback route here — sign-in is email and password
 * against Supabase directly (src/app/login/page.tsx), and the browser client
 * picks the session out of the URL it was redirected with. So the invite comes
 * back to /login, which exists, rather than to a callback route that does not.
 */
export const INVITE_REDIRECT_PATH = "/login";

/**
 * The public origin, from configuration only.
 *
 * Deliberately narrower than resolveCallbackBaseUrl() in lib/voice/config.ts,
 * which falls back to the forwarded request headers. This URL is emailed to a
 * person and is where they will type a password, so it must not be derivable
 * from a request header. Unset means unset: the caller omits redirectTo and
 * GoTrue uses the project's Site URL.
 */
export function resolveInviteRedirectUrl(): string | null {
  const configured =
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : "");

  if (!configured) return null;

  const withScheme = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  return `${withScheme.replace(/\/+$/, "")}${INVITE_REDIRECT_PATH}`;
}
