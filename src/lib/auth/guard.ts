import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The caller's agent_profiles row.
 *
 * `id` is the agent_profiles primary key — this is what leads.assigned_to
 * references, and it is NOT the same value as `user_id` (the auth.users id).
 * Mixing the two silently breaks every ownership check, so the distinction is
 * kept explicit in the type.
 */
export interface AgentContext {
  id: string;
  user_id: string;
  display_name: string;
  email: string;
  role: "admin" | "agent";
  is_active: boolean;
}

export interface Guarded {
  agent: AgentContext;
  supabase: SupabaseClient;
  userId: string;
}

/**
 * Thrown-and-caught sentinel carrying the response to return. Route handlers
 * use the `requireUser`/`requireAdmin` result union instead of exceptions, so
 * this stays internal.
 */
type GuardFailure = { ok: false; response: NextResponse };
type GuardSuccess = { ok: true } & Guarded;
export type GuardResult = GuardSuccess | GuardFailure;

function unauthorized(message = "Unauthorized"): GuardFailure {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status: 401 }),
  };
}

function forbidden(message = "Forbidden"): GuardFailure {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status: 403 }),
  };
}

/**
 * Resolve the calling user and their agent profile.
 *
 * Returns 401 when there is no session, and 403 when the session is valid but
 * the user has no active agent profile — a real user who has been deactivated
 * or was never onboarded is authenticated but not authorized to use the app.
 *
 * Always uses the request-scoped SSR client, never the service-role client, so
 * every query this returns is still subject to RLS. The guard is defence in
 * depth on top of the policies, not a replacement for them.
 */
export async function requireUser(): Promise<GuardResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return unauthorized();

  const { data: profile, error: profileError } = await supabase
    .from("agent_profiles")
    .select("id, user_id, display_name, email, role, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    return forbidden("Could not resolve agent profile");
  }
  if (!profile) {
    return forbidden("No agent profile for this account");
  }
  if (!profile.is_active) {
    return forbidden("This account has been deactivated");
  }

  return {
    ok: true,
    agent: profile as AgentContext,
    supabase,
    userId: user.id,
  };
}

/** Same as requireUser, but additionally requires the admin role. */
export async function requireAdmin(): Promise<GuardResult> {
  const result = await requireUser();
  if (!result.ok) return result;

  if (result.agent.role !== "admin") {
    return forbidden("Admin access required");
  }

  return result;
}
