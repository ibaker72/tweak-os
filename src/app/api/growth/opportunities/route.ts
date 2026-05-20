import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  discoverKeywordOpportunities,
  calculateOpportunityScore,
  estimateSearchVolume,
  estimateDifficultyScore,
} from "@/lib/growth/keyword-research";
import { logActivity } from "@/lib/shared/activity-logger";
import { trackApiUsage } from "@/lib/leads/api-usage";

// GET /api/growth/opportunities — list opportunities with optional filters
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status");
    const cluster = searchParams.get("cluster");
    const sortBy = searchParams.get("sort_by") || "opportunity_score";
    const sortOrder = searchParams.get("sort_order") || "desc";
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    let query = supabase.from("growth_opportunities").select("*", { count: "exact" });

    if (status) {
      query = query.eq("status", status);
    }
    if (cluster) {
      query = query.eq("cluster", cluster);
    }

    query = query
      .order(sortBy, { ascending: sortOrder === "asc" })
      .limit(limit);

    const { data, count, error } = await query;
    if (error) throw error;

    return NextResponse.json({ opportunities: data ?? [], count: count ?? 0 });
  } catch (err) {
    console.error("Opportunities GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch opportunities" },
      { status: 500 }
    );
  }
}

// POST /api/growth/opportunities — discover new opportunities from seed keyword
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { seed } = body;

    if (!seed || typeof seed !== "string") {
      return NextResponse.json(
        { error: "seed is required" },
        { status: 400 }
      );
    }

    const results = await discoverKeywordOpportunities(seed);
    await trackApiUsage(supabase, "anthropic", "claude-haiku-4-5");

    const opportunitiesToInsert = results.map((result) => {
      const opportunityScore = calculateOpportunityScore(
        result.search_demand,
        result.difficulty,
        result.relevance_score
      );
      const searchVolume = estimateSearchVolume(result.search_demand);
      const difficultyScore = estimateDifficultyScore(result.difficulty);

      return {
        keyword: result.keyword,
        search_volume: searchVolume,
        difficulty_score: difficultyScore,
        intent: result.intent,
        relevance_score: result.relevance_score,
        opportunity_score: opportunityScore,
        status: "discovered" as const,
        source: "ai_suggested",
        cluster: seed,
      };
    });

    const { data: inserted, error } = await supabase
      .from("growth_opportunities")
      .insert(opportunitiesToInsert)
      .select();

    if (error) throw error;

    await logActivity(supabase, {
      module: "growth",
      action: "opportunities_discovered",
      entity_type: "growth_opportunity",
      details: { seed, count: inserted?.length ?? 0 },
    });

    return NextResponse.json({
      opportunities: inserted ?? [],
      count: inserted?.length ?? 0,
    });
  } catch (err) {
    console.error("Opportunities POST error:", err);
    return NextResponse.json(
      { error: "Failed to discover opportunities" },
      { status: 500 }
    );
  }
}

// PATCH /api/growth/opportunities — update opportunity (bulk or single)
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { ids, status, notes } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("growth_opportunities")
      .update(updates)
      .in("id", ids);

    if (error) throw error;

    return NextResponse.json({ updated: ids.length });
  } catch (err) {
    console.error("Opportunities PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update opportunities" },
      { status: 500 }
    );
  }
}

// DELETE /api/growth/opportunities — delete opportunities
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("growth_opportunities")
      .delete()
      .in("id", ids);

    if (error) throw error;

    return NextResponse.json({ deleted: ids.length });
  } catch (err) {
    console.error("Opportunities DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete opportunities" },
      { status: 500 }
    );
  }
}
