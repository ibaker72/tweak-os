import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateBrief } from "@/lib/growth/brief-generator";
import { logActivity } from "@/lib/shared/activity-logger";
import { trackApiUsage } from "@/lib/leads/api-usage";

// GET /api/growth/briefs — list briefs with filters
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status");
    const opportunityId = searchParams.get("opportunity_id");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    let query = supabase
      .from("growth_briefs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }
    if (opportunityId) {
      query = query.eq("opportunity_id", opportunityId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ briefs: data ?? [] });
  } catch (err) {
    console.error("Briefs GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch briefs" },
      { status: 500 }
    );
  }
}

// POST /api/growth/briefs — generate a brief from keyword
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { keyword, opportunity_id } = body;

    if (!keyword || typeof keyword !== "string") {
      return NextResponse.json(
        { error: "keyword is required" },
        { status: 400 }
      );
    }

    const generated = await generateBrief(keyword);
    await trackApiUsage(supabase, "anthropic", "claude-haiku-4-5");

    const briefRecord = {
      opportunity_id: opportunity_id ?? null,
      title: generated.title_options[0] ?? keyword,
      target_keyword: keyword,
      secondary_keywords: [],
      target_url: generated.target_url,
      content_type: "blog_post" as const,
      outline: generated.outline,
      target_word_count: generated.target_word_count,
      target_audience: "Founders and small business owners",
      cta_strategy: generated.cta_strategy,
      internal_links: generated.internal_links,
      competitor_urls: [],
      status: "draft" as const,
    };

    const { data: brief, error } = await supabase
      .from("growth_briefs")
      .insert(briefRecord)
      .select()
      .single();

    if (error) throw error;

    await logActivity(supabase, {
      module: "growth",
      action: "brief_generated",
      entity_type: "growth_brief",
      entity_id: brief.id,
      details: { keyword, title: brief.title },
    });

    return NextResponse.json({ brief });
  } catch (err) {
    console.error("Briefs POST error:", err);
    return NextResponse.json(
      { error: "Failed to generate brief" },
      { status: 500 }
    );
  }
}

// PATCH /api/growth/briefs — update brief
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const allowedFields = [
      "title",
      "outline",
      "status",
      "target_word_count",
      "target_keyword",
      "secondary_keywords",
      "target_url",
      "content_type",
      "target_audience",
      "cta_strategy",
      "internal_links",
      "competitor_urls",
    ];

    const filtered: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }

    if (Object.keys(filtered).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data: brief, error } = await supabase
      .from("growth_briefs")
      .update(filtered)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ brief });
  } catch (err) {
    console.error("Briefs PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update brief" },
      { status: 500 }
    );
  }
}
