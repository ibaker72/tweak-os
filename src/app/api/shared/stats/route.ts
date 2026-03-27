import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/leads/queries";
import { getGrowthDashboardStats } from "@/lib/growth/analytics";
import { getRecentActivity } from "@/lib/shared/activity-logger";
import { getOutreachStats } from "@/lib/leads/sequences";
import { getAgentWorkload } from "@/lib/leads/assignment";

// GET /api/shared/stats — dashboard stats for unified view
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    const [leadStats, growthStats, recentActivity, outreachStats, agentStats] =
      await Promise.all([
        getDashboardStats(supabase),
        getGrowthDashboardStats(supabase),
        getRecentActivity(supabase, { limit: 10 }),
        getOutreachStats(supabase).catch(() => ({
          sent: 0,
          opened: 0,
          replied: 0,
          bounced: 0,
        })),
        getAgentWorkload(supabase).catch(() => []),
      ]);

    // Calculate reply rate
    const replyRate =
      outreachStats.sent > 0
        ? Math.round((outreachStats.replied / outreachStats.sent) * 100)
        : 0;
    const openRate =
      outreachStats.sent > 0
        ? Math.round((outreachStats.opened / outreachStats.sent) * 100)
        : 0;

    // Pipeline velocity: average days between lifecycle transitions
    let pipelineVelocity = {
      new_to_contacted: 0,
      contacted_to_replied: 0,
      replied_to_booked: 0,
    };

    try {
      const { data: contactedLeads } = await supabase
        .from("leads")
        .select("created_at, contacted_at")
        .eq("lifecycle_status", "contacted")
        .not("contacted_at", "is", null)
        .limit(50);

      if (contactedLeads && contactedLeads.length > 0) {
        const diffs = contactedLeads.map(
          (l: { created_at: string; contacted_at: string }) =>
            (new Date(l.contacted_at).getTime() -
              new Date(l.created_at).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        pipelineVelocity.new_to_contacted = Math.round(
          diffs.reduce((a: number, b: number) => a + b, 0) / diffs.length
        );
      }
    } catch {
      // ignore velocity calculation errors
    }

    return NextResponse.json({
      leads: leadStats,
      growth: growthStats,
      recent_activity: recentActivity,
      outreach_stats: {
        ...outreachStats,
        reply_rate: replyRate,
        open_rate: openRate,
      },
      agent_stats: agentStats,
      pipeline_velocity: pipelineVelocity,
    });
  } catch (err) {
    console.error("Stats GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
