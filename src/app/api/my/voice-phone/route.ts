import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";

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
 * An admin setting someone else's number uses POST /api/admin/team instead.
 */
const patchSchema = z
  .object({
    // Free-form on the way in — the database normalises it to E.164 and
    // refuses what it cannot. Null or blank clears the number.
    voice_phone: z.string().max(32).nullable(),
  })
  .strict();

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    // RLS restricts agent_profiles to the caller's own row, and this filters
    // to it anyway so an admin gets their own row rather than the first one.
    const { data, error } = await guard.supabase
      .from("agent_profiles")
      .select("voice_phone")
      .eq("id", guard.agent.id)
      .maybeSingle<{ voice_phone: string | null }>();

    if (error) throw error;
    return NextResponse.json({ voice_phone: data?.voice_phone ?? null });
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

  try {
    const { data, error } = await guard.supabase.rpc("set_my_voice_phone", {
      p_phone: parsed.data.voice_phone,
    });
    if (error) throw error;

    const result = (data ?? {}) as { ok?: boolean; voice_phone?: string | null };
    if (result.ok !== true) {
      return NextResponse.json(
        {
          error:
            "That does not look like a phone number we can dial. Use a US number or full E.164 form, e.g. +18622984988.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, voice_phone: result.voice_phone ?? null });
  } catch (err) {
    console.error("[my/voice-phone] PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to save your callback number" },
      { status: 500 }
    );
  }
}
