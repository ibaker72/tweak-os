import { SupabaseClient } from "@supabase/supabase-js";

export interface AgentWorkload {
  agent_id: string;
  display_name: string;
  total_leads: number;
  contacted: number;
  replied: number;
  booked: number;
}

export async function assignLeadsToAgent(
  supabase: SupabaseClient,
  leadIds: string[],
  agentId: string
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      assigned_to: agentId,
      assigned_at: new Date().toISOString(),
    })
    .in("id", leadIds);
  if (error) throw error;
}

export async function autoAssignRoundRobin(
  supabase: SupabaseClient,
  leadIds: string[]
): Promise<{ assignments: Record<string, string[]> }> {
  // Get active agents
  const { data: agents, error: agentsError } = await supabase
    .from("agent_profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .order("display_name");

  if (agentsError) throw agentsError;
  if (!agents || agents.length === 0) {
    throw new Error("No active agents available for assignment");
  }

  const assignments: Record<string, string[]> = {};
  for (const agent of agents) {
    assignments[agent.id] = [];
  }

  // Round-robin distribute
  for (let i = 0; i < leadIds.length; i++) {
    const agent = agents[i % agents.length];
    assignments[agent.id].push(leadIds[i]);
  }

  // Bulk assign per agent
  const now = new Date().toISOString();
  for (const [agentId, ids] of Object.entries(assignments)) {
    if (ids.length === 0) continue;
    const { error } = await supabase
      .from("leads")
      .update({ assigned_to: agentId, assigned_at: now })
      .in("id", ids);
    if (error) throw error;
  }

  return { assignments };
}

export async function getAgentWorkload(
  supabase: SupabaseClient
): Promise<AgentWorkload[]> {
  const { data: agents, error: agentsError } = await supabase
    .from("agent_profiles")
    .select("id, display_name")
    .eq("is_active", true);

  if (agentsError) throw agentsError;
  if (!agents || agents.length === 0) return [];

  const workloads: AgentWorkload[] = [];

  for (const agent of agents) {
    const [totalRes, contactedRes, repliedRes, bookedRes] = await Promise.all([
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("assigned_to", agent.id),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("assigned_to", agent.id)
        .eq("lifecycle_status", "contacted"),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("assigned_to", agent.id)
        .eq("lifecycle_status", "replied"),
      supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("assigned_to", agent.id)
        .eq("lifecycle_status", "meeting_booked"),
    ]);

    workloads.push({
      agent_id: agent.id,
      display_name: agent.display_name,
      total_leads: totalRes.count ?? 0,
      contacted: contactedRes.count ?? 0,
      replied: repliedRes.count ?? 0,
      booked: bookedRes.count ?? 0,
    });
  }

  return workloads;
}
