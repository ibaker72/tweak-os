import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { countWords } from "@/lib/growth/draft-generator";
import { analyzeSeo, estimateReadability } from "@/lib/growth/seo-analyzer";
import { logActivity } from "@/lib/shared/activity-logger";

// GET /api/growth/drafts/[id] — get single draft by ID (join brief and opportunity)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const { data: draft, error } = await supabase
      .from("growth_drafts")
      .select("*, growth_briefs(*), growth_opportunities(*)")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          { error: "Draft not found" },
          { status: 404 }
        );
      }
      throw error;
    }

    // Flatten joined data
    const result = {
      ...draft,
      brief: draft.growth_briefs ?? undefined,
      opportunity: draft.growth_opportunities ?? undefined,
      growth_briefs: undefined,
      growth_opportunities: undefined,
    };

    return NextResponse.json({ draft: result });
  } catch (err) {
    console.error("Draft GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch draft" },
      { status: 500 }
    );
  }
}

// PATCH /api/growth/drafts/[id] — update draft
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      "title",
      "content",
      "slug",
      "meta_title",
      "meta_description",
      "status",
      "scheduled_for",
      "published_url",
    ];

    const updates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    // If content is updated, recalculate derived fields
    if (updates.content) {
      const content = updates.content as string;

      // Fetch existing draft for keyword context
      const { data: existing } = await supabase
        .from("growth_drafts")
        .select("title, slug, meta_title, meta_description, brief_id")
        .eq("id", id)
        .single();

      // Get target keyword from the brief if available
      let targetKeyword = "";
      if (existing?.brief_id) {
        const { data: brief } = await supabase
          .from("growth_briefs")
          .select("target_keyword")
          .eq("id", existing.brief_id)
          .single();
        targetKeyword = brief?.target_keyword ?? "";
      }

      updates.word_count = countWords(content);
      updates.readability_score = estimateReadability(content);

      if (targetKeyword) {
        const { score, feedback } = analyzeSeo({
          title: (updates.title as string) ?? existing?.title ?? "",
          content,
          meta_title: (updates.meta_title as string) ?? existing?.meta_title ?? null,
          meta_description: (updates.meta_description as string) ?? existing?.meta_description ?? null,
          target_keyword: targetKeyword,
          slug: (updates.slug as string) ?? existing?.slug ?? null,
        });
        updates.seo_score = score;
        updates.seo_feedback = feedback;
      }
    }

    // If status changes to published, set published_at
    if (updates.status === "published") {
      updates.published_at = new Date().toISOString();
    }

    const { data: draft, error } = await supabase
      .from("growth_drafts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Log activity on status changes
    if (updates.status) {
      await logActivity(supabase, {
        module: "growth",
        action: `draft_${updates.status}`,
        entity_type: "growth_draft",
        entity_id: id,
        details: { title: draft.title, status: updates.status },
      });
    }

    return NextResponse.json({ draft });
  } catch (err) {
    console.error("Draft PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update draft" },
      { status: 500 }
    );
  }
}

// DELETE /api/growth/drafts/[id] — delete draft
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const { error } = await supabase
      .from("growth_drafts")
      .delete()
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Draft DELETE error:", err);
    return NextResponse.json(
      { error: "Failed to delete draft" },
      { status: 500 }
    );
  }
}
