import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { getCallbackPhone } from "@/lib/voice/callback-phone";
import { normalizeCallbackPhone } from "@/lib/phone";

export const runtime = "nodejs";

/**
 * The agent's own Twilio callback number — the phone the click-to-call rings
 * first. Read and write, scoped to the caller and to that one column.
 *
 * Agents have no UPDATE policy on agent_profiles and this does not add one:
 * the write goes through set_my_voice_phone(), a definer function that
 * resolves the agent from the JWT and touches nothing but voice_phone. That
 * is the difference between letting someone set their callback number and
 * letting them set their own commission rate.
 *
 * Erasing the number is a separate request, not the absence of one. The
 * earlier version treated a blank field as "clear it", so a Save pressed on an
 * empty box wiped the setting and answered 200 — which is exactly how the
 * production number went missing on 2026-09-02. A blank body now needs
 * `clear: true` to mean anything.
 *
 * An admin setting someone else's number uses POST /api/admin/team instead.
 */
const patchSchema = z
  .object({
    // Free-form on the way in — the database normalises it to E.164 and
    // refuses what it cannot dial.
    voice_phone: z.string().max(32).nullable(),
    // Explicit intent to erase. Required for a blank voice_phone to do
    // anything at all.
    clear: z.boolean().optional(),
  })
  .strict();

/** What each refusal from set_my_voice_phone() means to the person reading it. */
const REFUSALS: Record<string, string> = {
  blank_without_clear:
    "No number was entered, so nothing was changed. Type a number and press Save, or use Remove to erase the one you have.",
  invalid_phone:
    "That does not look like a phone number we can dial. Use a US number or full E.164 form, e.g. +18622984988.",
  not_saved:
    "The database did not accept the change, so your callback number is unchanged. Try again, and tell an admin if it keeps happening.",
};

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const voicePhone = await getCallbackPhone(guard.supabase, {
      agentId: guard.agent.id,
    });
    return NextResponse.json({ voice_phone: voicePhone });
  } catch (err) {
    console.error("[my/voice-phone] GET error:", err);
    return NextResponse.json(
      { error: "Failed to load your callback number" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { voice_phone: submitted, clear = false } = parsed.data;
  const isBlank = submitted === null || submitted.trim() === "";

  // Refused here as well as in the function. The database is the enforcement
  // point; this is so the message says what to do instead of what went wrong.
  if (isBlank && !clear) {
    return NextResponse.json({ error: REFUSALS.blank_without_clear }, { status: 400 });
  }

  // Reject locally what the database would reject anyway, using the same rules
  // private.normalize_phone() applies, so a typo comes back as a sentence
  // rather than as a round trip.
  if (!isBlank && normalizeCallbackPhone(submitted) === null) {
    return NextResponse.json({ error: REFUSALS.invalid_phone }, { status: 400 });
  }

  try {
    const { data, error } = await guard.supabase.rpc("set_my_voice_phone", {
      p_phone: isBlank ? null : submitted,
      p_clear: clear,
    });
    if (error) throw error;

    const result = (data ?? {}) as {
      ok?: boolean;
      reason?: string;
      cleared?: boolean;
      voice_phone?: string | null;
    };

    if (result.ok !== true) {
      return NextResponse.json(
        { error: REFUSALS[result.reason ?? ""] ?? REFUSALS.invalid_phone },
        { status: 400 }
      );
    }

    // Read the column back through the ordinary RLS-bound path before saying
    // it saved. set_my_voice_phone() already verifies its own write; this
    // verifies it from outside the function, which is the check that would
    // have caught the original failure from the API's side. A success this
    // route reports is a value the next GET will return.
    const stored = await getCallbackPhone(guard.supabase, { agentId: guard.agent.id });
    if (stored !== (result.voice_phone ?? null)) {
      console.error("[my/voice-phone] write did not verify", {
        agent_id: guard.agent.id,
      });
      return NextResponse.json({ error: REFUSALS.not_saved }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      cleared: result.cleared === true,
      voice_phone: stored,
    });
  } catch (err) {
    console.error("[my/voice-phone] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to save your callback number" },
      { status: 500 }
    );
  }
}
