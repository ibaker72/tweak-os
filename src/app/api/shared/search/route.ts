import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/shared/search — global search across leads, opportunities, and drafts
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");

    if (!q || q.trim().length === 0) {
      return NextResponse.json(
        { error: "q (search query) is required" },
        { status: 400 }
      );
    }

    const searchTerm = `%${q}%`;

    // Search in parallel across all three tables
    const [leadsRes, opportunitiesRes, draftsRes] = await Promise.all([
      supabase
        .from("leads")
        .select("id, business_name, city, niche")
        .ilike("business_name", searchTerm)
        .limit(10),
      supabase
        .from("growth_opportunities")
        .select("id, keyword, cluster, status")
        .ilike("keyword", searchTerm)
        .limit(10),
      supabase
        .from("growth_drafts")
        .select("id, title, status, slug")
        .ilike("title", searchTerm)
        .limit(10),
    ]);

    const results: {
      type: "lead" | "opportunity" | "draft";
      id: string;
      title: string;
      subtitle?: string;
    }[] = [];

    // Map leads
    for (const lead of (leadsRes.data ?? []) as {
      id: string;
      business_name: string;
      city: string | null;
      niche: string | null;
    }[]) {
      results.push({
        type: "lead",
        id: lead.id,
        title: lead.business_name,
        subtitle: [lead.niche, lead.city].filter(Boolean).join(" · ") || undefined,
      });
    }

    // Map opportunities
    for (const opp of (opportunitiesRes.data ?? []) as {
      id: string;
      keyword: string;
      cluster: string | null;
      status: string;
    }[]) {
      results.push({
        type: "opportunity",
        id: opp.id,
        title: opp.keyword,
        subtitle: [opp.cluster, opp.status].filter(Boolean).join(" · ") || undefined,
      });
    }

    // Map drafts
    for (const draft of (draftsRes.data ?? []) as {
      id: string;
      title: string;
      status: string;
      slug: string | null;
    }[]) {
      results.push({
        type: "draft",
        id: draft.id,
        title: draft.title,
        subtitle: [draft.status, draft.slug].filter(Boolean).join(" · ") || undefined,
      });
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Search GET error:", err);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
