import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import { NET_TERMS_DAYS } from "@/lib/commissions/calculate";

/**
 * POST /api/admin/commissions/adjust — a manual ledger entry.
 *
 * This is the escape hatch for everything the engine cannot derive: a
 * discretionary bonus, a negotiated correction, a setter's cut settled by hand
 * because split credit is not built yet.
 *
 * The memo is required and substantive. An adjustment is, by definition, a
 * number that no rule produced — so the only thing standing between it and an
 * unanswerable question six months later is the sentence explaining it. The
 * database will happily store "fix"; this will not.
 *
 * There is no update path and no delete path. A wrong adjustment is corrected
 * by a further, offsetting adjustment, like every other row in the ledger.
 */

const MIN_MEMO = 10;

const bodySchema = z
  .object({
    agent_id: z.string().uuid(),
    deal_id: z.string().uuid(),
    entry_type: z.enum(["adjustment", "bonus"]),
    amount_cents: z.number().int().refine((v) => v !== 0, {
      message: "A zero-value entry records nothing",
    }),
    memo: z
      .string()
      .trim()
      .min(MIN_MEMO, `Explain the adjustment — at least ${MIN_MEMO} characters`)
      .max(2000),
    /** Defaults to Net 30 from now, matching how earned entries are stamped. */
    payable_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((v) => v.entry_type !== "bonus" || v.amount_cents > 0, {
    message: "A bonus must be positive — use an adjustment to deduct",
    path: ["amount_cents"],
  });

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

  const input = parsed.data;

  try {
    // Confirm both ends exist before writing money against them.
    const [{ data: agent }, { data: deal }] = await Promise.all([
      guard.supabase
        .from("agent_profiles")
        .select("id, display_name")
        .eq("id", input.agent_id)
        .maybeSingle<{ id: string; display_name: string }>(),
      guard.supabase
        .from("deals")
        .select("id, name")
        .eq("id", input.deal_id)
        .maybeSingle<{ id: string; name: string }>(),
    ]);

    if (!agent) {
      return NextResponse.json({ error: "No such agent" }, { status: 404 });
    }
    if (!deal) {
      return NextResponse.json({ error: "No such deal" }, { status: 404 });
    }

    const payableAt =
      input.payable_at ??
      (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + NET_TERMS_DAYS);
        return d.toISOString();
      })();

    const { data: entry, error } = await guard.supabase
      .from("commission_entries")
      .insert({
        agent_id: input.agent_id,
        deal_id: input.deal_id,
        payment_id: null,
        entry_type: input.entry_type,
        amount_cents: input.amount_cents,
        // No rate or basis: a manual entry is not derived from either, and
        // filling them in would imply a calculation that never happened.
        rate_bps_applied: null,
        basis_cents: null,
        memo: input.memo,
        payable_at: payableAt,
        created_by: guard.agent.id,
      })
      .select("id, amount_cents, entry_type, payable_at")
      .single();

    if (error) {
      // The sign/type check on the table catches a negative bonus.
      if (error.code === "23514") {
        return NextResponse.json(
          { error: "That amount is not valid for this entry type" },
          { status: 400 }
        );
      }
      throw error;
    }

    await guard.supabase.from("activity_log").insert({
      module: "platform",
      action: "commission.manual_entry",
      entity_type: "commission_entry",
      entity_id: (entry as { id: string }).id,
      details: {
        admin_id: guard.agent.id,
        agent_id: input.agent_id,
        agent_name: agent.display_name,
        deal_id: input.deal_id,
        deal_name: deal.name,
        entry_type: input.entry_type,
        amount_cents: input.amount_cents,
        memo: input.memo,
      },
    });

    return NextResponse.json({ ok: true, entry }, { status: 201 });
  } catch (err) {
    console.error("Manual commission entry error:", err);
    return NextResponse.json({ error: "Failed to write entry" }, { status: 500 });
  }
}
