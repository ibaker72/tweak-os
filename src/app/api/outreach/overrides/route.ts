import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";

/**
 * Per-agent overrides of the shared outreach templates.
 *
 * The team templates stay admin-owned. An agent who wants their own wording
 * gets a row here rather than editing the shared copy out from under everyone
 * else. RLS scopes these to the caller, and the insert policy requires
 * agent_id to be their own — so an agent cannot write an override onto a
 * teammate's account.
 *
 * GET returns each template already merged with the caller's override, so
 * callers never have to remember to apply one.
 */

const upsertSchema = z
  .object({
    template_id: z.string().uuid(),
    subject: z.string().max(300).nullable().default(null),
    body: z.string().max(20_000).nullable().default(null),
  })
  .strict()
  .refine((v) => v.subject !== null || v.body !== null, {
    message: "An override must change the subject, the body, or both",
  });

const deleteSchema = z.object({ template_id: z.string().uuid() }).strict();

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const [{ data: templates, error: tErr }, { data: overrides, error: oErr }] =
      await Promise.all([
        guard.supabase
          .from("outreach_templates")
          .select("id, name, channel, subject, body, variables, is_active, sort_order")
          .eq("is_active", true)
          .order("sort_order"),
        guard.supabase
          .from("agent_template_overrides")
          .select("template_id, subject, body, updated_at")
          .eq("agent_id", guard.agent.id),
      ]);

    if (tErr) throw tErr;
    if (oErr) throw oErr;

    const byTemplate = new Map(
      (
        (overrides ?? []) as {
          template_id: string;
          subject: string | null;
          body: string | null;
          updated_at: string;
        }[]
      ).map((o) => [o.template_id, o])
    );

    const merged = (
      (templates ?? []) as {
        id: string;
        name: string;
        channel: string;
        subject: string | null;
        body: string;
        variables: string[] | null;
        sort_order: number;
      }[]
    ).map((t) => {
      const override = byTemplate.get(t.id);
      return {
        ...t,
        // The effective text the agent will actually send.
        subject: override?.subject ?? t.subject,
        body: override?.body ?? t.body,
        // The shared original, so the UI can show what was changed and offer
        // a revert without a second request.
        team_subject: t.subject,
        team_body: t.body,
        is_overridden: Boolean(override),
        overridden_at: override?.updated_at ?? null,
      };
    });

    return NextResponse.json({ templates: merged });
  } catch (err) {
    console.error("Template overrides GET error:", err);
    return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    // Delete-then-insert rather than upsert: the unique constraint is
    // (agent_id, template_id), and this keeps the write to columns the agent's
    // own policies allow without relying on conflict-target support.
    await guard.supabase
      .from("agent_template_overrides")
      .delete()
      .eq("agent_id", guard.agent.id)
      .eq("template_id", parsed.data.template_id);

    const { data, error } = await guard.supabase
      .from("agent_template_overrides")
      .insert({
        agent_id: guard.agent.id,
        template_id: parsed.data.template_id,
        subject: parsed.data.subject,
        body: parsed.data.body,
      })
      .select("template_id, subject, body, updated_at")
      .single();

    if (error) {
      if (error.code === "23503") {
        return NextResponse.json({ error: "No such template" }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({ override: data });
  } catch (err) {
    console.error("Template override PUT error:", err);
    return NextResponse.json({ error: "Failed to save override" }, { status: 500 });
  }
}

/** Revert to the team template. */
export async function DELETE(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const parsed = deleteSchema.safeParse({
    template_id: searchParams.get("template_id") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const { error } = await guard.supabase
      .from("agent_template_overrides")
      .delete()
      .eq("agent_id", guard.agent.id)
      .eq("template_id", parsed.data.template_id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Template override DELETE error:", err);
    return NextResponse.json({ error: "Failed to remove override" }, { status: 500 });
  }
}
