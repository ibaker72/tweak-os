import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";

// GET /api/leads/list — lightweight lead list for picker dropdowns
export async function GET(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const perPage = Math.min(
      Math.max(parseInt(searchParams.get("per_page") ?? "100", 10) || 100, 1),
      500
    );

    const supabase = guard.supabase;
    const { data, error } = await supabase
      .from("leads")
      .select("id, business_name, website, city, state")
      .order("created_at", { ascending: false })
      .limit(perPage);

    if (error) throw error;

    return NextResponse.json({ leads: data ?? [] });
  } catch (err) {
    console.error("Lead list error:", err);
    return NextResponse.json(
      { error: "Failed to load leads" },
      { status: 500 }
    );
  }
}
