import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateDraft, countWords, generateMetaTitle, generateMetaDescription } from "@/lib/growth/draft-generator";
import { analyzeSeo, estimateReadability } from "@/lib/growth/seo-analyzer";
import { logActivity } from "@/lib/shared/activity-logger";
import { trackApiUsage } from "@/lib/leads/api-usage";
import type { GrowthBrief } from "@/types/growth";

// GET /api/growth/drafts — list drafts with filters
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status");
    const briefId = searchParams.get("brief_id");
    const sortBy = searchParams.get("sort_by") || "created_at";
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    let query = supabase
      .from("growth_drafts")
      .select("*", { count: "exact" })
      .order(sortBy, { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }
    if (briefId) {
      query = query.eq("brief_id", briefId);
    }

    const { data, count, error } = await query;
    if (error) throw error;

    return NextResponse.json({ drafts: data ?? [], count: count ?? 0 });
  } catch (err) {
    console.error("Drafts GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch drafts" },
      { status: 500 }
    );
  }
}

// POST /api/growth/drafts — generate a draft from brief
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { brief_id } = body;

    if (!brief_id) {
      return NextResponse.json(
        { error: "brief_id is required" },
        { status: 400 }
      );
    }

    // Fetch the brief
    const { data: brief, error: briefError } = await supabase
      .from("growth_briefs")
      .select("*")
      .eq("id", brief_id)
      .single();

    if (briefError) {
      if (briefError.code === "PGRST116") {
        return NextResponse.json(
          { error: "Brief not found" },
          { status: 404 }
        );
      }
      throw briefError;
    }

    const typedBrief = brief as GrowthBrief;

    // Generate the draft content
    const content = await generateDraft(typedBrief);
    await trackApiUsage(supabase, "openai", "gpt-4o-mini");

    const wordCount = countWords(content);
    const metaTitle = generateMetaTitle(typedBrief.title, typedBrief.target_keyword);
    const metaDescription = generateMetaDescription(content, typedBrief.target_keyword);
    const slug = typedBrief.target_keyword
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Analyze SEO
    const { score: seoScore, feedback: seoFeedback } = analyzeSeo({
      title: typedBrief.title,
      content,
      meta_title: metaTitle,
      meta_description: metaDescription,
      target_keyword: typedBrief.target_keyword,
      slug,
    });

    const readabilityScore = estimateReadability(content);

    // Create draft record
    const draftRecord = {
      brief_id,
      opportunity_id: typedBrief.opportunity_id,
      title: typedBrief.title,
      slug,
      content,
      meta_title: metaTitle,
      meta_description: metaDescription,
      word_count: wordCount,
      seo_score: seoScore,
      seo_feedback: seoFeedback,
      readability_score: readabilityScore,
      status: "draft" as const,
      version: 1,
    };

    const { data: draft, error: insertError } = await supabase
      .from("growth_drafts")
      .insert(draftRecord)
      .select()
      .single();

    if (insertError) throw insertError;

    // Update brief status to in_progress
    await supabase
      .from("growth_briefs")
      .update({ status: "in_progress" })
      .eq("id", brief_id);

    await logActivity(supabase, {
      module: "growth",
      action: "draft_generated",
      entity_type: "growth_draft",
      entity_id: draft.id,
      details: { title: draft.title, word_count: wordCount, seo_score: seoScore },
    });

    return NextResponse.json({ draft });
  } catch (err) {
    console.error("Drafts POST error:", err);
    return NextResponse.json(
      { error: "Failed to generate draft" },
      { status: 500 }
    );
  }
}
