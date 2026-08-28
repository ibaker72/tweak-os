import { NextRequest, NextResponse } from "next/server";
import { getRecentActivity } from "@/lib/shared/activity-logger";
import type { Module } from "@/types/shared";
import { requireUser } from "@/lib/auth/guard";

// GET /api/shared/activity — get recent activity across all modules
export async function GET(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const supabase = guard.supabase;
    const { searchParams } = new URL(request.url);

    const moduleParam = searchParams.get("module") as Module | null;
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const activities = await getRecentActivity(supabase, {
      module: moduleParam ?? undefined,
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
