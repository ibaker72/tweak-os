import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getGrowthDashboardStats,
  getPerformanceByDraft,
  getAllPerformance,
  upsertPerformance,
} from "@/lib/growth/analytics";

// GET /api/growth/analytics — get performance data
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const draftId = searchParams.get("draft_id");

    let performance;
    if (draftId) {
      performance = await getPerformanceByDraft(supabase, draftId);
    } else {
      performance = await getAllPerformance(supabase);
    }

    const stats = await getGrowthDashboardStats(supabase);

    return NextResponse.json({ performance, stats });
  } catch (err) {
    console.error("Analytics GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}

// POST /api/growth/analytics — add/update performance data
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    const { draft_id, date } = body;

    if (!draft_id || !date) {
      return NextResponse.json(
        { error: "draft_id and date are required" },
        { status: 400 }
      );
    }

    await upsertPerformance(supabase, {
      draft_id: body.draft_id,
      date: body.date,
      impressions: body.impressions,
      clicks: body.clicks,
      ctr: body.ctr,
      avg_position: body.avg_position,
      page_views: body.page_views,
      avg_time_on_page: body.avg_time_on_page,
      bounce_rate: body.bounce_rate,
      conversions: body.conversions,
      top_queries: body.top_queries,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Analytics POST error:", err);
    return NextResponse.json(
      { error: "Failed to upsert performance data" },
      { status: 500 }
    );
  }
}
