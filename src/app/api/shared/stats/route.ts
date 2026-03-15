import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/leads/queries";
import { getGrowthDashboardStats } from "@/lib/growth/analytics";
import { getRecentActivity } from "@/lib/shared/activity-logger";

// GET /api/shared/stats — dashboard stats for unified view
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    const [leadStats, growthStats, recentActivity] = await Promise.all([
      getDashboardStats(supabase),
      getGrowthDashboardStats(supabase),
      getRecentActivity(supabase, { limit: 10 }),
    ]);

    return NextResponse.json({
      leads: leadStats,
      growth: growthStats,
      recent_activity: recentActivity,
    });
  } catch (err) {
    console.error("Stats GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
