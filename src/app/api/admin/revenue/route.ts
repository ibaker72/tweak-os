import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import {
  agentPerformance,
  monthlyBuckets,
  revenueSummary,
  type DealRow,
  type EntryRow,
  type PaymentRow,
} from "@/lib/admin/revenue";

/**
 * GET /api/admin/revenue — MRR, new business by month, close rate by agent,
 * and commission as a share of collected revenue.
 *
 * That last figure is the one worth watching. It is what tells you whether the
 * commission structure is working, and it is invisible on any individual deal
 * — an uncapped recurring rate does its damage across the book, a month at a
 * time, never on a line item anyone is looking at.
 */

const querySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});

export async function GET(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ months: searchParams.get("months") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const [{ data: deals }, { data: payments }, { data: entries }, { data: agents }] =
      await Promise.all([
        guard.supabase
          .from("deals")
          .select(
            "id, account_id, commission_model, mrr_cents, contract_value_cents, " +
              "status, closed_by_agent_id, signed_at, commission_rate_bps, " +
              "recurring_cap_months, recurring_months_accrued"
          ),
        guard.supabase
          .from("payments")
          .select("deal_id, amount_cents, refunded_amount_cents, cleared_at, received_at"),
        guard.supabase
          .from("commission_entries")
          .select("agent_id, deal_id, amount_cents, created_at"),
        guard.supabase.from("agent_directory").select("id, display_name, is_active"),
      ]);

    const dealRows = (deals ?? []) as unknown as (DealRow & {
      commission_rate_bps: number | null;
      recurring_cap_months: number | null;
      recurring_months_accrued: number;
    })[];
    const paymentRows = (payments ?? []) as unknown as PaymentRow[];
    const entryRows = (entries ?? []) as unknown as EntryRow[];

    const ratesByDeal = Object.fromEntries(
      dealRows.map((d) => [
        d.id,
        {
          rateBps: d.commission_rate_bps,
          capMonths: d.recurring_cap_months,
          accrued: d.recurring_months_accrued,
        },
      ])
    );

    const summary = revenueSummary({
      deals: dealRows,
      payments: paymentRows,
      entries: entryRows,
      ratesByDeal,
    });

    const agentNames = new Map(
      ((agents ?? []) as { id: string; display_name: string }[]).map((a) => [
        a.id,
        a.display_name,
      ])
    );

    return NextResponse.json({
      summary,
      months: monthlyBuckets({
        deals: dealRows,
        payments: paymentRows,
        entries: entryRows,
        months: parsed.data.months,
      }),
      agents: agentPerformance({
        deals: dealRows,
        payments: paymentRows,
        entries: entryRows,
      }).map((a) => ({ ...a, displayName: agentNames.get(a.agentId) ?? "Unknown" })),
    });
  } catch (err) {
    console.error("Admin revenue GET error:", err);
    return NextResponse.json({ error: "Failed to load revenue" }, { status: 500 });
  }
}
