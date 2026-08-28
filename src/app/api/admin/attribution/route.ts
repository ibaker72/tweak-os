import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import {
  decisionMarginDays,
  findConflicts,
  validateOverride,
  type AttributionRow,
} from "@/lib/admin/attribution";

/**
 * The attribution conflict queue.
 *
 * A conflict is a lead more than one agent holds a live claim on. Resolving
 * one decides who gets paid, so an override requires a written reason — and
 * the reason is stored on the row, not just logged, so it travels with the
 * decision rather than living in a separate audit trail someone has to think
 * to go and read.
 */

const ATTRIBUTION_COLUMNS =
  "id, agent_id, lead_id, source, first_touch_at, expires_at, resolved_at, " +
  "is_override, override_reason, override_by";

const overrideSchema = z
  .object({
    action: z.literal("override"),
    lead_id: z.string().uuid(),
    /** The agent the credit should go to. */
    agent_id: z.string().uuid(),
    reason: z.string().min(1).max(2000),
  })
  .strict();

const createSchema = z
  .object({
    action: z.literal("create"),
    lead_id: z.string().uuid(),
    agent_id: z.string().uuid(),
    source: z.enum(["referral_link", "manual_intro", "self_sourced", "inbound_assigned"]),
    first_touch_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [overrideSchema, createSchema]);

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { data, error } = await guard.supabase
      .from("attributions")
      .select(ATTRIBUTION_COLUMNS);

    if (error) throw error;

    const rows = (data ?? []) as unknown as AttributionRow[];
    const conflicts = findConflicts(rows);

    // Names for the UI, so a conflict does not read as a wall of uuids.
    const leadIds = [...new Set(conflicts.map((c) => c.leadId))];
    const agentIds = [...new Set(rows.map((r) => r.agent_id))];

    const [{ data: leads }, { data: agents }] = await Promise.all([
      leadIds.length
        ? guard.supabase.from("leads").select("id, business_name").in("id", leadIds)
        : Promise.resolve({ data: [] }),
      agentIds.length
        ? guard.supabase.from("agent_directory").select("id, display_name").in("id", agentIds)
        : Promise.resolve({ data: [] }),
    ]);

    const leadNames = new Map(
      ((leads ?? []) as { id: string; business_name: string }[]).map((l) => [
        l.id,
        l.business_name,
      ])
    );
    const agentNames = new Map(
      ((agents ?? []) as { id: string; display_name: string }[]).map((a) => [
        a.id,
        a.display_name,
      ])
    );

    return NextResponse.json({
      conflicts: conflicts.map((c) => ({
        ...c,
        lead_name: leadNames.get(c.leadId) ?? null,
        margin_days: decisionMarginDays(c),
        claims: c.claims.map((claim) => ({
          ...claim,
          agent_name: agentNames.get(claim.agent_id) ?? null,
        })),
      })),
      total_attributions: rows.length,
    });
  } catch (err) {
    console.error("Attribution GET error:", err);
    return NextResponse.json({ error: "Failed to load conflicts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  try {
    if (body.action === "create") {
      // Manual intros and self-sourced claims need a row like everything else,
      // so the tie-break has one input set rather than a rule plus a folklore
      // exception. This is also how a lead gets marked self-sourced, which is
      // what selects the higher commission rate at conversion.
      const { data, error } = await guard.supabase
        .from("attributions")
        .insert({
          lead_id: body.lead_id,
          agent_id: body.agent_id,
          source: body.source,
          first_touch_at: body.first_touch_at ?? new Date().toISOString(),
        })
        .select(ATTRIBUTION_COLUMNS)
        .single();

      if (error) {
        if (error.code === "23503") {
          return NextResponse.json(
            { error: "No such lead or agent" },
            { status: 404 }
          );
        }
        throw error;
      }

      await guard.supabase.from("activity_log").insert({
        lead_id: body.lead_id,
        module: "leads",
        action: "attribution.created",
        entity_type: "lead",
        entity_id: body.lead_id,
        details: {
          admin_id: guard.agent.id,
          agent_id: body.agent_id,
          source: body.source,
        },
      });

      return NextResponse.json({ ok: true, attribution: data }, { status: 201 });
    }

    // Override: a written reason is mandatory, and a token one is refused.
    const validation = validateOverride({
      leadId: body.lead_id,
      agentId: body.agent_id,
      reason: body.reason,
      overrideBy: guard.agent.id,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const reason = body.reason.trim();

    // Clear any previous override on this lead so exactly one is in force.
    await guard.supabase
      .from("attributions")
      .update({ is_override: false, override_reason: null, override_by: null })
      .eq("lead_id", body.lead_id)
      .eq("is_override", true);

    const { data: existing } = await guard.supabase
      .from("attributions")
      .select("id")
      .eq("lead_id", body.lead_id)
      .eq("agent_id", body.agent_id)
      .limit(1)
      .maybeSingle<{ id: string }>();

    let attributionId: string;

    if (existing) {
      const { data, error } = await guard.supabase
        .from("attributions")
        .update({
          is_override: true,
          override_reason: reason,
          override_by: guard.agent.id,
        })
        .eq("id", existing.id)
        .select("id")
        .single();
      if (error) throw error;
      attributionId = (data as { id: string }).id;
    } else {
      // The agent being credited had no claim on file — the override creates
      // one rather than failing, since an admin deciding credit is itself the
      // claim.
      const { data, error } = await guard.supabase
        .from("attributions")
        .insert({
          lead_id: body.lead_id,
          agent_id: body.agent_id,
          source: "manual_intro",
          is_override: true,
          override_reason: reason,
          override_by: guard.agent.id,
        })
        .select("id")
        .single();
      if (error) throw error;
      attributionId = (data as { id: string }).id;
    }

    await guard.supabase.from("activity_log").insert({
      lead_id: body.lead_id,
      module: "leads",
      action: "attribution.overridden",
      entity_type: "lead",
      entity_id: body.lead_id,
      details: {
        admin_id: guard.agent.id,
        credited_agent_id: body.agent_id,
        attribution_id: attributionId,
        reason,
      },
    });

    return NextResponse.json({ ok: true, attribution_id: attributionId });
  } catch (err) {
    console.error("Attribution POST error:", err);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
