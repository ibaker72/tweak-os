import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/leads/work-queue — prioritized work queue for agents
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agent_id");
    const today = new Date().toISOString().split("T")[0];

    // 1. Leads with next_action_date <= today (overdue actions)
    let overdueQuery = supabase
      .from("leads")
      .select("id, business_name, score, priority, next_action, next_action_date, lifecycle_status, assigned_to, city, state, website")
      .lte("next_action_date", today)
      .not("next_action_date", "is", null)
      .order("priority")
      .order("next_action_date", { ascending: true })
      .limit(10);

    if (agentId) {
      overdueQuery = overdueQuery.eq("assigned_to", agentId);
    }

    // 2. Hot leads not yet contacted
    let hotQuery = supabase
      .from("leads")
      .select("id, business_name, score, priority, next_action, next_action_date, lifecycle_status, assigned_to, city, state, website, niche, tech_stack")
      .gte("score", 70)
      .in("lifecycle_status", ["new", "enriched"])
      .order("score", { ascending: false })
      .limit(10);

    if (agentId) {
      hotQuery = hotQuery.eq("assigned_to", agentId);
    }

    // 3. Overdue follow-ups (contacted but no reply in 3+ days)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    let followUpQuery = supabase
      .from("leads")
      .select("id, business_name, score, priority, next_action, next_action_date, lifecycle_status, assigned_to, city, state, contacted_at")
      .eq("lifecycle_status", "contacted")
      .lt("contacted_at", threeDaysAgo.toISOString())
      .order("contacted_at", { ascending: true })
      .limit(10);

    if (agentId) {
      followUpQuery = followUpQuery.eq("assigned_to", agentId);
    }

    const [overdueRes, hotRes, followUpRes] = await Promise.all([
      overdueQuery,
      hotQuery,
      followUpQuery,
    ]);

    // Due outreach sequences
    let sequencesQuery = supabase
      .from("outreach_sequences")
      .select("id, lead_id, channel, sequence_step, subject, body, status, scheduled_for")
      .gte("scheduled_for", `${today}T00:00:00.000Z`)
      .lte("scheduled_for", `${today}T23:59:59.999Z`)
      .in("status", ["draft", "sent"])
      .order("scheduled_for", { ascending: true })
      .limit(10);

    if (agentId) {
      sequencesQuery = sequencesQuery.eq("agent_id", agentId);
    }

    const sequencesRes = await sequencesQuery;

    return NextResponse.json({
      overdue_actions: overdueRes.data ?? [],
      hot_leads: hotRes.data ?? [],
      overdue_followups: followUpRes.data ?? [],
      due_sequences: sequencesRes.data ?? [],
    });
  } catch (err) {
    console.error("Work queue GET error:", err);
    return NextResponse.json({ error: "Failed to fetch work queue" }, { status: 500 });
  }
}
