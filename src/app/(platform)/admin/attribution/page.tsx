import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import {
  decisionMarginDays,
  findConflicts,
  type AttributionRow,
} from "@/lib/admin/attribution";
import { AttributionClient, type Conflict } from "./AttributionClient";

/**
 * /admin/attribution — the conflict queue.
 *
 * A conflict is a lead more than one agent holds a live claim on. Resolving
 * one decides who gets paid, so the override carries a required written reason
 * stored on the attribution row itself.
 */
export default async function AdminAttributionPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("attributions")
    .select(
      "id, agent_id, lead_id, source, first_touch_at, expires_at, resolved_at, " +
        "is_override, override_reason, override_by"
    );

  const rows = (data ?? []) as unknown as AttributionRow[];
  const conflicts = findConflicts(rows);

  const leadIds = [...new Set(conflicts.map((c) => c.leadId))];
  const agentIds = [...new Set(rows.map((r) => r.agent_id))];

  const [{ data: leads }, { data: agents }] = await Promise.all([
    leadIds.length
      ? supabase.from("leads").select("id, business_name").in("id", leadIds)
      : Promise.resolve({ data: [] }),
    agentIds.length
      ? supabase.from("agent_directory").select("id, display_name").in("id", agentIds)
      : Promise.resolve({ data: [] }),
  ]);

  const leadNames = new Map(
    ((leads ?? []) as { id: string; business_name: string }[]).map((l) => [l.id, l.business_name])
  );
  const agentNames = new Map(
    ((agents ?? []) as { id: string; display_name: string }[]).map((a) => [a.id, a.display_name])
  );

  const withNames: Conflict[] = conflicts.map((c) => ({
    leadId: c.leadId,
    lead_name: leadNames.get(c.leadId) ?? null,
    agentCount: c.agentCount,
    decidedByOverride: c.decidedByOverride,
    margin_days: decisionMarginDays(c),
    claims: c.claims.map((claim) => ({
      id: claim.id,
      agent_id: claim.agent_id,
      agent_name: agentNames.get(claim.agent_id) ?? null,
      source: claim.source,
      first_touch_at: claim.first_touch_at,
      expires_at: claim.expires_at,
      is_override: claim.is_override,
      override_reason: claim.override_reason,
    })),
    winner: {
      id: c.winner.id,
      agent_id: c.winner.agent_id,
      agent_name: agentNames.get(c.winner.agent_id) ?? null,
      source: c.winner.source,
      first_touch_at: c.winner.first_touch_at,
      expires_at: c.winner.expires_at,
      is_override: c.winner.is_override,
      override_reason: c.winner.override_reason,
    },
  }));

  return (
    <div className="space-y-5">
      <DashboardHeader
        title="Attribution"
        description="Leads more than one agent has a live claim on."
      />
      <AttributionClient conflicts={withNames} />
      <p className="text-xs text-zinc-600">
        Tie-break: an admin override wins outright, otherwise the earliest non-expired first
        touch. The same rule runs inside the conversion, so what you see here is what will
        happen. Claims expire 90 days after first touch unless overridden.
      </p>
    </div>
  );
}
