import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import {
  buildDealViews,
  groupByStage,
  isPerMonthForecast,
  pipelineTotals,
  type LedgerTotalsByDeal,
  type PipelineDeal,
} from "@/lib/agent/pipeline";
import { centsToDecimalString } from "@/lib/agent/commission-csv";

/**
 * /my/pipeline — an agent's deals by stage, with what each is worth to them.
 *
 * Earned and expected are shown as separate columns and never summed together.
 * Earned is money the ledger says exists; expected is a forecast that pays
 * nothing until a payment clears. Blending them into one number would read as
 * "what I am owed", which is the one thing it is not.
 *
 * RLS scopes `deals` to the deals the caller closed.
 */

function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${centsToDecimalString(Math.abs(cents))}`;
}

const STAGE_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  delivering: "Delivering",
  complete: "Complete",
  lost: "Lost",
  refunded: "Refunded",
};

export default async function MyPipelinePage() {
  const supabase = await createClient();

  const [{ data: deals }, { data: accounts }, { data: entries }] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id, name, account_id, deal_type, commission_model, contract_value_cents, " +
          "mrr_cents, status, commission_rate_bps, recurring_cap_months, " +
          "recurring_months_accrued, signed_at"
      )
      .order("signed_at", { ascending: false, nullsFirst: false }),
    supabase.from("accounts").select("id, company_name"),
    supabase
      .from("commission_entries")
      .select("deal_id, amount_cents, payout_batch_id"),
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
    const t = ledger[row.deal_id] ?? { earnedCents: 0, unpaidCents: 0 };
    t.earnedCents += row.amount_cents;
    if (row.payout_batch_id === null) t.unpaidCents += row.amount_cents;
    ledger[row.deal_id] = t;
  }

  const views = buildDealViews(
    ((deals ?? []) as unknown as Omit<PipelineDeal, "account_name">[]).map((d) => ({
      ...d,
      account_name: accountNames.get(d.account_id) ?? null,
    })),
    ledger
  );

  const stages = groupByStage(views);
  const totals = pipelineTotals(views);

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="My Pipeline"
        description="Your deals by stage, and what each is worth to you."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Earned" value={usd(totals.earnedCents)} tone="lime" hint="in the ledger" />
        <Stat label="Unpaid" value={usd(totals.unpaidCents)} hint="awaiting payout" />
        <Stat
          label="Expected"
          value={usd(totals.expectedCents)}
          tone="muted"
          hint="forecast, not owed"
        />
        <Stat label="Live deals" value={String(totals.liveDeals)} hint={`${totals.deadDeals} closed out`} />
      </div>

      {stages.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-zinc-400">No deals yet.</p>
            <p className="mt-1 text-xs text-zinc-600">
              Convert a lead from its detail page to start a deal.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {stages.map((stage) => (
            <section key={stage.status}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium text-zinc-300">
                  {STAGE_LABELS[stage.status] ?? stage.status}
                  <span className="ml-2 text-xs text-zinc-600">{stage.deals.length}</span>
                </h2>
                <div className="flex gap-4 text-xs">
                  <span className="text-lime-400">{usd(stage.earnedCents)} earned</span>
                  <span className="text-zinc-500">{usd(stage.expectedCents)} expected</span>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-zinc-800">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                      <th className="px-3 py-2 font-medium">Deal</th>
                      <th className="px-3 py-2 font-medium">Contract</th>
                      <th className="px-3 py-2 font-medium">Rate</th>
                      <th className="px-3 py-2 text-right font-medium">Earned</th>
                      <th className="px-3 py-2 text-right font-medium">Expected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {stage.deals.map((deal) => (
                      <tr key={deal.id} className="hover:bg-zinc-900/50">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-zinc-200">{deal.name}</div>
                          <div className="text-xs text-zinc-500">
                            {deal.account_name ?? "—"} · {deal.deal_type.replace(/_/g, " ")}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-zinc-400">
                          {deal.commission_model === "recurring" ? (
                            <>
                              {usd(deal.mrr_cents)}/mo
                              <span className="ml-1 text-xs text-zinc-600">
                                {deal.recurring_cap_months
                                  ? `cap ${deal.recurring_months_accrued}/${deal.recurring_cap_months}`
                                  : "uncapped"}
                              </span>
                            </>
                          ) : (
                            usd(deal.contract_value_cents)
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-zinc-500">
                          {deal.commission_rate_bps === null
                            ? "—"
                            : `${(deal.commission_rate_bps / 100).toFixed(2)}%`}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-lime-400">
                          {deal.earnedCents === 0 ? (
                            <span className="text-zinc-700">—</span>
                          ) : (
                            usd(deal.earnedCents)
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">
                          {deal.expectedCents === null ? (
                            <span title="No rate snapshot on this deal yet" className="text-zinc-700">
                              —
                            </span>
                          ) : (
                            <>
                              {usd(deal.expectedCents)}
                              {isPerMonthForecast(deal) && (
                                <span className="text-zinc-600">/mo</span>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-600">
        Earned is what the commission ledger actually holds. Expected is a forecast on the
        full contract — commission accrues only when a payment clears.{" "}
        <Link href="/my/commissions" className="text-lime-400 hover:text-lime-300">
          See the ledger →
        </Link>
      </p>
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
  tone?: "lime" | "muted";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
        <p
          className={`mt-1 font-mono text-lg ${
            tone === "lime" ? "text-lime-400" : tone === "muted" ? "text-zinc-400" : "text-zinc-100"
          }`}
        >
          {value}
        </p>
        {hint && <p className="mt-0.5 text-[11px] text-zinc-600">{hint}</p>}
      </CardContent>
    </Card>
  );
}
