import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { getUnpaidBalances } from "@/lib/commissions/balances";
import {
  CommissionsClient,
  type AgentBalanceRow,
  type BatchRow,
  type DealOption,
} from "./CommissionsClient";

/** /admin/commissions — every agent's balance, payout batching, manual entries. */
export default async function AdminCommissionsPage() {
  const supabase = await createClient();

  const [balances, { data: agents }, { data: batches }, { data: deals }] = await Promise.all([
    getUnpaidBalances(supabase),
    supabase
      .from("agent_profiles")
      .select("id, display_name, email, is_active, partner_type, payout_method, payout_handle")
      .order("display_name"),
    supabase
      .from("payout_batches")
      .select(
        "id, agent_id, period_start, period_end, total_cents, method, status, paid_at, external_ref, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("deals").select("id, name, closed_by_agent_id").order("created_at", {
      ascending: false,
    }),
  ]);

  const byAgent = new Map(balances.map((b) => [b.agentId, b]));

  const rows: AgentBalanceRow[] = (
    (agents ?? []) as unknown as Omit<AgentBalanceRow, "unpaid_cents" | "payable_now_cents">[]
  ).map((agent) => ({
    ...agent,
    unpaid_cents: byAgent.get(agent.id)?.unpaidCents ?? 0,
    payable_now_cents: byAgent.get(agent.id)?.payableNowCents ?? 0,
  }));

  const dealOptions: DealOption[] = (
    (deals ?? []) as unknown as { id: string; name: string; closed_by_agent_id: string | null }[]
  ).map((d) => ({ id: d.id, name: d.name, agent_id: d.closed_by_agent_id }));

  return (
    <div className="space-y-5">
      <DashboardHeader
        title="Commissions"
        description="Balances, payout batches, and manual ledger entries."
      />
      <CommissionsClient
        agents={rows}
        batches={(batches ?? []) as unknown as BatchRow[]}
        deals={dealOptions}
      />
    </div>
  );
}
