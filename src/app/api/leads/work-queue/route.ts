import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_LIMITS = [10, 25, 50, 100] as const;

function parseLimit(raw: string | null, fallback = 50): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return (ALLOWED_LIMITS as readonly number[]).includes(n) ? n : fallback;
}

// GET /api/leads/work-queue — prioritized work queue for agents.
// Supports ?limit=10|25|50|100 (default 50) for the hot-leads section, plus
// an optional ?agent_id filter.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get("agent_id");
    const limit = parseLimit(searchParams.get("limit"), 50);
    const today = new Date().toISOString().split("T")[0];

    // Active filter — excludes archived/deleted leads from all sections.
    const excludeStates = "(archived,deleted)";

    // 1. Leads with next_action_date <= today (overdue actions)
    let overdueQuery = supabase
      .from("leads")
      .select("id, business_name, score, priority, next_action, next_action_date, lifecycle_status, assigned_to, city, state, website")
      .lte("next_action_date", today)
      .not("next_action_date", "is", null)
      .is("archived_at", null)
      .is("deleted_at", null)
      .not("lifecycle_status", "in", excludeStates)
      .order("priority")
      .order("next_action_date", { ascending: true })
      .limit(limit);

    if (agentId) {
      overdueQuery = overdueQuery.eq("assigned_to", agentId);
    }

    // 2. Hot leads ready for outreach. Count uses `head:true` to get the
    //    accurate total — the rendered list is limited.
    const hotBase = supabase
      .from("leads")
      .select("id, business_name, score, priority, next_action, next_action_date, lifecycle_status, assigned_to, city, state, website, niche, tech_stack, created_at", { count: "exact" })
      .gte("score", 70)
      .in("lifecycle_status", ["new", "enriched"])
      .is("archived_at", null)
      .is("deleted_at", null);

    let hotQuery = hotBase
      .order("score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

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
      .is("archived_at", null)
      .is("deleted_at", null)
      .lt("contacted_at", threeDaysAgo.toISOString())
      .order("contacted_at", { ascending: true })
      .limit(limit);

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
      .limit(limit);

    if (agentId) {
      sequencesQuery = sequencesQuery.eq("agent_id", agentId);
    }

    const sequencesRes = await sequencesQuery;

    return NextResponse.json({
      overdue_actions: overdueRes.data ?? [],
      hot_leads: hotRes.data ?? [],
      hot_leads_total: hotRes.count ?? 0,
      overdue_followups: followUpRes.data ?? [],
      due_sequences: sequencesRes.data ?? [],
      limit,
    });
  } catch (err) {
    console.error("Work queue GET error:", err);
    return NextResponse.json({ error: "Failed to fetch work queue" }, { status: 500 });
  }
}
