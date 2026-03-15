import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/growth/briefs/[id] — get single brief by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const { data: brief, error } = await supabase
      .from("growth_briefs")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Brief not found" },
          { status: 404 }
        );
      }
      throw error;
    }

    return NextResponse.json({ brief });
  } catch (err) {
    console.error("Brief GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch brief" },
      { status: 500 }
    );
  }
}
