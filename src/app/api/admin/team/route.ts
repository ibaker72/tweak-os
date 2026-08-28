import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";

/**
 * Team management: rates, classification, payout details, and reassigning a
 * departing agent's book.
 *
 * The rate rule that matters: changing an agent's rate here affects future
 * deals only. Existing deals carry the rate snapshotted onto them at
 * conversion and are never repriced — the UI says so explicitly, because a
 * rate change that silently rewrote history would be discovered by an agent
 * looking at their own ledger, which is the worst possible way to find out.
 */

const updateSchema = z
  .object({
    action: z.literal("update"),
    agent_id: z.string().uuid(),
    display_name: z.string().min(1).max(120).optional(),
    default_commission_rate_bps: z.number().int().min(0).max(10_000).optional(),
    inbound_commission_rate_bps: z.number().int().min(0).max(10_000).optional(),
    partner_type: z.enum(["internal_agent", "referral_partner"]).optional(),
    employment_classification: z
      .enum(["contractor_1099", "employee_w2", "unset"])
      .optional(),
    payout_method: z.enum(["stripe", "paypal"]).nullable().optional(),
    payout_handle: z.string().max(200).nullable().optional(),
    legal_name: z.string().max(200).nullable().optional(),
    tax_address: z.string().max(500).nullable().optional(),
    // Last four only. The full TIN belongs wherever the 1099 is filed, not in
    // an application database.
    tax_id_last4: z
      .string()
      .regex(/^\d{4}$/, "Store the last four digits only")
      .nullable()
      .optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const reassignSchema = z
  .object({
    action: z.literal("reassign_book"),
    from_agent_id: z.string().uuid(),
    to_agent_id: z.string().uuid(),
    deactivate: z.boolean().default(false),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [updateSchema, reassignSchema]);

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const [{ data: agents, error }, { data: deals }] = await Promise.all([
      guard.supabase
        .from("agent_profiles")
        .select(
          "id, user_id, display_name, email, role, is_active, started_at, " +
            "partner_type, default_commission_rate_bps, inbound_commission_rate_bps, " +
            "payout_method, payout_handle, employment_classification, legal_name, " +
            "tax_address, tax_id_last4, created_at"
        )
        .order("display_name"),
      guard.supabase.from("deals").select("id, closed_by_agent_id, status, commission_rate_bps"),
    ]);

    if (error) throw error;

    // How many existing deals each agent has, and at what rates — so the UI
    // can say exactly what a rate change will and will not touch.
    const snapshot = new Map<string, { deals: number; rates: Set<number> }>();
    for (const deal of (deals ?? []) as {
      closed_by_agent_id: string | null;
      commission_rate_bps: number | null;
      status: string;
    }[]) {
      if (!deal.closed_by_agent_id) continue;
      if (deal.status === "lost") continue;
      const entry = snapshot.get(deal.closed_by_agent_id) ?? {
        deals: 0,
        rates: new Set<number>(),
      };
      entry.deals += 1;
      if (deal.commission_rate_bps !== null) entry.rates.add(deal.commission_rate_bps);
      snapshot.set(deal.closed_by_agent_id, entry);
    }

    const rows = ((agents ?? []) as unknown as { id: string }[]).map((agent) => {
      const snap = snapshot.get(agent.id);
      return {
        ...agent,
        existing_deal_count: snap?.deals ?? 0,
        existing_rates_bps: snap ? [...snap.rates].sort((a, b) => a - b) : [],
      };
    });

    return NextResponse.json({ agents: rows });
  } catch (err) {
    console.error("Admin team GET error:", err);
    return NextResponse.json({ error: "Failed to load team" }, { status: 500 });
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
    if (body.action === "reassign_book") {
      if (body.from_agent_id === body.to_agent_id) {
        return NextResponse.json(
          { error: "Cannot reassign an agent to themselves" },
          { status: 400 }
        );
      }
      if (body.deactivate && body.from_agent_id === guard.agent.id) {
        return NextResponse.json(
          { error: "You cannot deactivate your own account" },
          { status: 400 }
        );
      }

      const { data, error } = await guard.supabase.rpc("reassign_agent_book", {
        p_from_agent: body.from_agent_id,
        p_to_agent: body.to_agent_id,
        p_deactivate: body.deactivate,
      });

      if (error) {
        if (error.code === "22023") {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        throw error;
      }

      return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
    }

    const { action, agent_id, ...updates } = body;
    void action;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // Same self-lockout guards as /api/agents.
    if (agent_id === guard.agent.id && updates.is_active === false) {
      return NextResponse.json(
        { error: "You cannot deactivate your own account" },
        { status: 400 }
      );
    }

    const { data: before } = await guard.supabase
      .from("agent_profiles")
      .select("default_commission_rate_bps, inbound_commission_rate_bps, is_active")
      .eq("id", agent_id)
      .maybeSingle<{
        default_commission_rate_bps: number;
        inbound_commission_rate_bps: number;
        is_active: boolean;
      }>();

    if (!before) {
      return NextResponse.json({ error: "No such agent" }, { status: 404 });
    }

    const { data, error } = await guard.supabase
      .from("agent_profiles")
      .update(updates)
      .eq("id", agent_id)
      .select("id, display_name, default_commission_rate_bps, inbound_commission_rate_bps, is_active")
      .single();

    if (error) {
      if (error.code === "23514") {
        return NextResponse.json(
          { error: "A rate must be between 0 and 10000 basis points" },
          { status: 400 }
        );
      }
      throw error;
    }

    // Rate changes are logged with both values. This is the record that shows
    // a rate changed on a date, which is what makes "future deals only"
    // verifiable rather than merely asserted.
    const rateChanged =
      (updates.default_commission_rate_bps !== undefined &&
        updates.default_commission_rate_bps !== before.default_commission_rate_bps) ||
      (updates.inbound_commission_rate_bps !== undefined &&
        updates.inbound_commission_rate_bps !== before.inbound_commission_rate_bps);

    if (rateChanged) {
      await guard.supabase.from("activity_log").insert({
        module: "platform",
        action: "agent.rate_changed",
        entity_type: "agent_profile",
        entity_id: agent_id,
        details: {
          admin_id: guard.agent.id,
          from_default_bps: before.default_commission_rate_bps,
          to_default_bps:
            updates.default_commission_rate_bps ?? before.default_commission_rate_bps,
          from_inbound_bps: before.inbound_commission_rate_bps,
          to_inbound_bps:
            updates.inbound_commission_rate_bps ?? before.inbound_commission_rate_bps,
          note: "applies to deals converted from now on; existing deals keep their snapshot",
        },
      });
    }

    return NextResponse.json({ ok: true, agent: data, rate_changed: rateChanged });
  } catch (err) {
    console.error("Admin team POST error:", err);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}
