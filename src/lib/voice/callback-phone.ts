// The one place the app reads an agent's click-to-call callback number.
//
// There is exactly one canonical location for it:
//
//     public.agent_profiles.voice_phone   (E.164, nullable)
//
// added by migration 00021 and constrained by agent_profiles_voice_phone_ck.
// Three surfaces need it — the Settings field, the lead page's Calling panel,
// and request_voice_call() inside the database — and the whole point of this
// module is that the two TypeScript ones read it through the same function, so
// "Settings saved it but the lead page cannot see it" is not a state the app
// can reach through a typo in a column name.
//
// Writes do not live here. An agent has no UPDATE policy on agent_profiles;
// the only write path is public.set_my_voice_phone(), called from
// PATCH /api/my/voice-phone.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The canonical table and column. Referenced by tests so a rename is loud. */
export const CALLBACK_PHONE_TABLE = "agent_profiles" as const;
export const CALLBACK_PHONE_COLUMN = "voice_phone" as const;

type CallbackPhoneRow = { voice_phone: string | null };

/**
 * The callback number for one agent, or null when they have not set one.
 *
 * `supabase` must be the request-scoped client. RLS restricts a non-admin to
 * their own agent_profiles row, and the filter below is what keeps an admin —
 * who can read every row — reading their own rather than an arbitrary one.
 *
 * Identify the agent by whichever id the caller happens to hold:
 *   `{ agentId }`  the agent_profiles primary key (what requireUser returns)
 *   `{ userId }`   the auth.users id (what supabase.auth.getUser returns)
 * These are different columns on the same row, and mixing them up silently
 * returns nothing — which is why this takes a tagged object rather than a
 * bare string.
 */
export async function getCallbackPhone(
  supabase: SupabaseClient,
  key: { agentId: string } | { userId: string }
): Promise<string | null> {
  const column = "agentId" in key ? "id" : "user_id";
  const value = "agentId" in key ? key.agentId : key.userId;

  const { data, error } = await supabase
    .from(CALLBACK_PHONE_TABLE)
    .select(CALLBACK_PHONE_COLUMN)
    .eq(column, value)
    .maybeSingle<CallbackPhoneRow>();

  if (error) throw error;
  return data?.voice_phone ?? null;
}
