import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRecentActivity } from "@/lib/shared/activity-logger";
import type { Module } from "@/types/shared";

// GET /api/shared/activity — get recent activity across all modules
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const module = searchParams.get("module") as Module | null;
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const activities = await getRecentActivity(supabase, {
      module: module ?? undefined,
      limit,
    });

    return NextResponse.json({ activities });
  } catch (err) {
    console.error("Activity GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 }
    );
  }
}
