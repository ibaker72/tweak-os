import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Card, CardContent } from "@/components/ui/card";
import { getAgentBalance } from "@/lib/commissions/balances";
import { requireUser } from "@/lib/auth/guard";
import { centsToDecimalString } from "@/lib/agent/commission-csv";
import { Download } from "lucide-react";
import { redirect } from "next/navigation";

/**
 * /my/commissions — the ledger.
 *
 * On straight commission this page is the agent's entire compensation record,
 * so it has to be defensible without anyone present to explain it. Every row
 * shows the basis and the rate that produced the amount, so any figure can be
 * re-derived by hand from the page alone.
 *
 * RLS scopes commission_entries to the caller's own rows.
 */

function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${centsToDecimalString(Math.abs(cents))}`;
}

export default async function MyCommissionsPage() {
  const guard = await requireUser();
  if (!guard.ok) redirect("/login");

  const supabase = await createClient();
  const balance = await getAgentBalance(supabase, guard.agent.id);

  const [{ data: entries }, { data: deals }, { data: accounts }, { data: batches }] =
    await Promise.all([
      supabase
        .from("commission_entries")
        .select(
          "id, created_at, entry_type, amount_cents, rate_bps_applied, basis_cents, " +
            "memo, payable_at, payout_batch_id, deal_id"
        )
        .eq("agent_id", guard.agent.id)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("deals").select("id, name, account_id"),
      supabase.from("accounts").select("id, company_name"),
      supabase.from("payout_batches").select("id, status, paid_at"),
    ]);

  const dealMap = new Map(
    ((deals ?? []) as { id: string; name: string; account_id: string }[]).map((d) => [d.id, d])
  );
  const accountMap = new Map(
    ((accounts ?? []) as { id: string; company_name: string }[]).map((a) => [a.id, a.company_name])
  );
  const batchMap = new Map(
    ((batches ?? []) as { id: string; status: string; paid_at: string | null }[]).map((b) => [
      b.id,
      b,
    ])
  );

  const rows = (entries ?? []) as unknown as {
    id: string;
    created_at: string;
    entry_type: string;
    amount_cents: number;
    rate_bps_applied: number | null;
    basis_cents: number | null;
    memo: string | null;
    payable_at: string;
    payout_batch_id: string | null;
    deal_id: string;
  }[];

  const today = new Date().toISOString();

  return (
    <div className="space-y-6">
      <DashboardHeader title="My Commissions" description="Every entry, and how it was calculated.">
        <a
          href="/api/my/commissions?format=csv"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 sm:w-auto"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </a>
      </DashboardHeader>

      {/* Top line: what is owed right now. */}
      <Card>
        <CardContent className="p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Unpaid balance</p>
          <p
            className={`mt-1 font-mono text-3xl ${
              balance.unpaidCents < 0 ? "text-red-400" : "text-lime-400"
            }`}
          >
            {usd(balance.unpaidCents)}
          </p>
          {balance.unpaidCents < 0 && (
            <p className="mt-1 text-xs text-red-400/80">
              Negative from clawbacks — this carries against future earnings.
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-800 pt-4 sm:grid-cols-4">
            <Mini label="Payable now" value={usd(balance.payableNowCents)} hint="Net 30 elapsed" />
            <Mini label="Pending" value={usd(balance.pendingCents)} hint="still within Net 30" />
            <Mini label="Lifetime earned" value={usd(balance.lifetimeEarnedCents)} />
            <Mini label="Paid out" value={usd(balance.paidOutCents)} />
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-sm text-zinc-400">No commission entries yet.</p>
            <p className="mt-1 text-xs text-zinc-600">
              Commission accrues when a payment on your deal clears — not when it is signed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[840px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Deal</th>
                <th className="px-3 py-2 text-right font-medium">Basis</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Payable</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((row) => {
                const deal = dealMap.get(row.deal_id);
                const batch = row.payout_batch_id ? batchMap.get(row.payout_batch_id) : null;
                const negative = row.amount_cents < 0;
                const payableNow = !row.payout_batch_id && row.payable_at <= today;

                return (
                  <tr key={row.id} className="hover:bg-zinc-900/50">
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-zinc-400">
                      {row.created_at.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-zinc-200">{deal?.name ?? "—"}</div>
                      <div className="text-xs text-zinc-500">
                        {deal ? (accountMap.get(deal.account_id) ?? "—") : "—"}
                        {row.entry_type !== "earned" && (
                          <span className="ml-1.5 text-amber-400/80">{row.entry_type}</span>
                        )}
                      </div>
                      {row.memo && (
                        <div className="mt-0.5 truncate text-[11px] text-zinc-600">{row.memo}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {row.basis_cents === null ? "—" : usd(row.basis_cents)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {row.rate_bps_applied === null
                        ? "—"
                        : `${(row.rate_bps_applied / 100).toFixed(2)}%`}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono text-xs ${
                        negative ? "text-red-400" : "text-lime-400"
                      }`}
                    >
                      {usd(row.amount_cents)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-zinc-400">
                      {row.payable_at.slice(0, 10)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                      {batch ? (
                        <span className={batch.status === "paid" ? "text-lime-400" : "text-zinc-400"}>
                          {batch.status}
                          {batch.paid_at && (
                            <span className="ml-1 text-zinc-600">{batch.paid_at.slice(0, 10)}</span>
                          )}
                        </span>
                      ) : payableNow ? (
                        <span className="text-amber-400">payable</span>
                      ) : (
                        <span className="text-zinc-600">pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-zinc-600">
        Every entry shows the basis and the rate it was calculated at, so any amount here can be
        checked by hand. Entries are never edited or deleted — a correction is always a new,
        offsetting row.
      </p>
    </div>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-zinc-200">{value}</p>
      {hint && <p className="text-[10px] text-zinc-600">{hint}</p>}
    </div>
  );
}
