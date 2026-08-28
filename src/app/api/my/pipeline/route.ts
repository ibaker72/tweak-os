import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import {
  buildDealViews,
  groupByStage,
  pipelineTotals,
  type LedgerTotalsByDeal,
  type PipelineDeal,
} from "@/lib/agent/pipeline";

/**
 * GET /api/my/pipeline — the agent's deals by stage with what each is worth.
 *
 * RLS on `deals` exposes only deals the caller closed, so the scoping is the
 * database's, not a filter written here.
 */

const DEAL_COLUMNS =
  "id, name, account_id, deal_type, commission_model, contract_value_cents, " +
  "mrr_cents, status, commission_rate_bps, recurring_cap_months, " +
  "recurring_months_accrued, signed_at";

export async function GET() {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const { data: deals, error: dealsError } = await guard.supabase
      .from("deals")
      .select(DEAL_COLUMNS)
      .order("signed_at", { ascending: false, nullsFirst: false });

    if (dealsError) throw dealsError;
    const dealRows = (deals ?? []) as unknown as Omit<PipelineDeal, "account_name">[];

    if (dealRows.length === 0) {
      return NextResponse.json({
        stages: [],
        totals: pipelineTotals([]),
      });
    }

    // Account names and ledger totals, both RLS-scoped to the same caller.
    const [{ data: accounts }, { data: entries }] = await Promise.all([
      guard.supabase.from("accounts").select("id, company_name"),
      guard.supabase
        .from("commission_entries")
        .select("deal_id, amount_cents, payout_batch_id")
        .eq("agent_id", guard.agent.id),
    ]);

    const accountNames = new Map(
      ((accounts ?? []) as { id: string; company_name: string }[]).map((a) => [
        a.id,
        a.company_name,
      ])
    );

    const ledger: LedgerTotalsByDeal = {};
    for (const row of (entries ?? []) as unknown as {
      deal_id: string;
      amount_cents: number;
      payout_batch_id: string | null;
    }[]) {
      const totals = ledger[row.deal_id] ?? { earnedCents: 0, unpaidCents: 0 };
      totals.earnedCents += row.amount_cents;
      if (row.payout_batch_id === null) totals.unpaidCents += row.amount_cents;
      ledger[row.deal_id] = totals;
    }

    const views = buildDealViews(
      dealRows.map((d) => ({
        ...d,
        account_name: accountNames.get(d.account_id) ?? null,
      })),
      ledger
    );

    return NextResponse.json({
      stages: groupByStage(views),
      totals: pipelineTotals(views),
    });
  } catch (err) {
    console.error("Pipeline GET error:", err);
    return NextResponse.json({ error: "Failed to load pipeline" }, { status: 500 });
  }
}
