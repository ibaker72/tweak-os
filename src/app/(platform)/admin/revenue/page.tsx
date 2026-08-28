import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  agentPerformance,
  monthlyBuckets,
  revenueSummary,
  type DealRow,
  type EntryRow,
  type PaymentRow,
} from "@/lib/admin/revenue";
import { centsToDecimalString } from "@/lib/agent/commission-csv";

/**
 * /admin/revenue.
 *
 * The number this page exists for is commission as a share of collected
 * revenue. It is the one that answers whether the structure is working, and
 * the one no individual deal will ever show you — an uncapped recurring rate
 * does its damage across the book, a month at a time.
 */

function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${centsToDecimalString(Math.abs(cents))}`;
}

function pct(bps: number | null): string {
  return bps === null ? "—" : `${(bps / 100).toFixed(1)}%`;
}

export default async function AdminRevenuePage() {
  const supabase = await createClient();

  const [{ data: deals }, { data: payments }, { data: entries }, { data: agents }] =
    await Promise.all([
      supabase
        .from("deals")
        .select(
          "id, account_id, commission_model, mrr_cents, contract_value_cents, status, " +
            "closed_by_agent_id, signed_at, commission_rate_bps, recurring_cap_months, " +
            "recurring_months_accrued"
        ),
      supabase
        .from("payments")
        .select("deal_id, amount_cents, refunded_amount_cents, cleared_at, received_at"),
      supabase.from("commission_entries").select("agent_id, deal_id, amount_cents, created_at"),
      supabase.from("agent_directory").select("id, display_name"),
    ]);

  const dealRows = (deals ?? []) as unknown as (DealRow & {
    commission_rate_bps: number | null;
    recurring_cap_months: number | null;
    recurring_months_accrued: number;
  })[];
  const paymentRows = (payments ?? []) as unknown as PaymentRow[];
  const entryRows = (entries ?? []) as unknown as EntryRow[];

  const summary = revenueSummary({
    deals: dealRows,
    payments: paymentRows,
    entries: entryRows,
    ratesByDeal: Object.fromEntries(
      dealRows.map((d) => [
        d.id,
        {
          rateBps: d.commission_rate_bps,
          capMonths: d.recurring_cap_months,
          accrued: d.recurring_months_accrued,
        },
      ])
    ),
  });

  const months = monthlyBuckets({
    deals: dealRows,
    payments: paymentRows,
    entries: entryRows,
    months: 12,
  });

  const agentNames = new Map(
    ((agents ?? []) as { id: string; display_name: string }[]).map((a) => [a.id, a.display_name])
  );
  const perf = agentPerformance({
    deals: dealRows,
    payments: paymentRows,
    entries: entryRows,
  });

  const loadIsHigh = summary.commissionRateBps !== null && summary.commissionRateBps > 3000;

  return (
    <div className="space-y-6">
      <DashboardHeader title="Revenue" description="MRR, new business, and commission load." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="MRR" value={usd(summary.mrrCents)} hint="live recurring deals" />
        <Stat label="Collected" value={usd(summary.collectedCents)} hint="cleared, net of refunds" />
        <Stat label="Commission" value={usd(summary.commissionCents)} hint="written to the ledger" />
        <Stat
          label="Commission / collected"
          value={pct(summary.commissionRateBps)}
          tone={loadIsHigh ? "warn" : "lime"}
          hint="the number that matters"
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Forward commitment on retainers
          </p>
          <p className="mt-1 font-mono text-lg text-zinc-100">
            {usd(summary.recurringCommitmentCents)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Still owed if every capped retainer runs to its cap.
            {summary.uncappedRecurringDeals > 0 && (
              <span className="ml-1 text-amber-400">
                Excludes {summary.uncappedRecurringDeals} uncapped retainer
                {summary.uncappedRecurringDeals === 1 ? "" : "s"} — that liability has no end
                date, so it cannot honestly be added to this total.
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">By month</h2>
        {months.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-zinc-500">
              No signed deals or collections yet.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2 font-medium">Month</th>
                  <th className="px-3 py-2 text-right font-medium">New deals</th>
                  <th className="px-3 py-2 text-right font-medium">New business</th>
                  <th className="px-3 py-2 text-right font-medium">Collected</th>
                  <th className="px-3 py-2 text-right font-medium">Commission</th>
                  <th className="px-3 py-2 text-right font-medium">% of collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {months.map((m) => (
                  <tr key={m.month} className="hover:bg-zinc-900/50">
                    <td className="px-3 py-2.5 font-mono text-xs text-zinc-300">{m.month}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-zinc-400">{m.newDeals}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">
                      {usd(m.newBusinessCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">
                      {usd(m.collectedCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {usd(m.commissionCents)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono text-xs ${
                        m.commissionRateBps !== null && m.commissionRateBps > 3000
                          ? "text-amber-400"
                          : "text-zinc-400"
                      }`}
                    >
                      {pct(m.commissionRateBps)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-zinc-300">By agent</h2>
        {perf.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-zinc-500">
              No closed deals yet.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2 font-medium">Agent</th>
                  <th className="px-3 py-2 text-right font-medium">Won</th>
                  <th className="px-3 py-2 text-right font-medium">Lost</th>
                  <th className="px-3 py-2 text-right font-medium">Close rate</th>
                  <th className="px-3 py-2 text-right font-medium">New business</th>
                  <th className="px-3 py-2 text-right font-medium">Commission</th>
                  <th className="px-3 py-2 text-right font-medium">% of collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {perf.map((a) => (
                  <tr key={a.agentId} className="hover:bg-zinc-900/50">
                    <td className="px-3 py-2.5 text-zinc-200">
                      {agentNames.get(a.agentId) ?? "Unknown"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-zinc-400">{a.dealsWon}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-zinc-400">{a.dealsLost}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">
                      {pct(a.closeRateBps)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-300">
                      {usd(a.newBusinessCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {usd(a.commissionCents)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {pct(a.commissionRateOfCollectedBps)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-zinc-600">
          Close rate counts resolved deals only — a full pipeline that has not closed yet is not
          counted as losses. A dash means nothing has resolved either way.
        </p>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "lime" | "warn";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
        <p
          className={`mt-1 font-mono text-lg ${
            tone === "warn" ? "text-amber-400" : tone === "lime" ? "text-lime-400" : "text-zinc-100"
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>}
      </CardContent>
    </Card>
  );
}
