import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/guard";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { TeamClient, type TeamAgent } from "./TeamClient";

/** /admin/team — rates, classification, payout details, book reassignment. */
export default async function AdminTeamPage() {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/my/queue");

  const supabase = await createClient();

  const [{ data: agents }, { data: deals }] = await Promise.all([
    supabase
      .from("agent_profiles")
      .select(
        "id, display_name, email, role, is_active, started_at, partner_type, " +
          "default_commission_rate_bps, inbound_commission_rate_bps, payout_method, " +
          "payout_handle, employment_classification, legal_name, tax_address, tax_id_last4"
      )
      .order("display_name"),
    supabase.from("deals").select("closed_by_agent_id, status, commission_rate_bps"),
  ]);

  // Existing deal counts and their snapshotted rates, so the UI can state
  // precisely what a rate change will not touch.
  const snapshot = new Map<string, { deals: number; rates: Set<number> }>();
  for (const deal of (deals ?? []) as unknown as {
    closed_by_agent_id: string | null;
    status: string;
    commission_rate_bps: number | null;
  }[]) {
    if (!deal.closed_by_agent_id || deal.status === "lost") continue;
    const entry = snapshot.get(deal.closed_by_agent_id) ?? { deals: 0, rates: new Set<number>() };
    entry.deals += 1;
    if (deal.commission_rate_bps !== null) entry.rates.add(deal.commission_rate_bps);
    snapshot.set(deal.closed_by_agent_id, entry);
  }

  const rows: TeamAgent[] = (
    (agents ?? []) as unknown as Omit<TeamAgent, "existing_deal_count" | "existing_rates_bps">[]
  ).map((agent) => {
    const snap = snapshot.get(agent.id);
    return {
      ...agent,
      existing_deal_count: snap?.deals ?? 0,
      existing_rates_bps: snap ? [...snap.rates].sort((a, b) => a - b) : [],
    };
  });

  return (
    <div className="space-y-5">
      <DashboardHeader
        title="Team"
        description="Rates, classification, payout details, and book reassignment."
      />
      <TeamClient agents={rows} currentAdminId={guard.agent.id} />
    </div>
  );
}
