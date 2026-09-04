import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "./service";

/**
 * The Supabase Auth Admin API, and nothing else.
 *
 * Creating a login for a new teammate is the one thing the app cannot do with
 * the caller's own session: auth.users is not reachable through PostgREST, so
 * the invite has to go through the Admin API with the service-role key.
 *
 * This module exists so that need does not turn into a general RLS bypass.
 * `createServiceClient()` returns a client that can also read and write every
 * table with policies switched off; what is exported here is only the
 * `auth.admin` namespace hanging off it, which has no `.from()`. A route that
 * imports this can invite a user and look one up by email — it cannot touch
 * agent_profiles, leads, or commissions with elevated rights. Those writes
 * still go through the request-scoped client and the RLS policies, which is
 * what keeps `agent_profiles_admin_all` the actual enforcement boundary rather
 * than a formality.
 *
 * Server-only. Nothing under this path may be imported from a client
 * component; `agent-onboarding-ui.test.ts` asserts that it is not.
 */
export type AdminAuthApi = SupabaseClient["auth"]["admin"];

/** Raised when the server has no service-role key to invite anybody with. */
export class AdminAuthUnavailableError extends Error {
  constructor() {
    super("Supabase admin credentials are not configured on this server");
    this.name = "AdminAuthUnavailableError";
  }
}

/**
 * Whether the Auth Admin API can be used at all.
 *
 * Checked before the client is built so a missing env var surfaces as a
 * readable "invitations are not configured" instead of a 401 from GoTrue
 * carrying an `undefined` bearer token.
 */
export function isAdminAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export function getAdminAuth(): AdminAuthApi {
  if (!isAdminAuthConfigured()) throw new AdminAuthUnavailableError();
  return createServiceClient().auth.admin;
}
