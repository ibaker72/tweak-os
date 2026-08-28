import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";

const querySchema = z.object({
  q: z.string().trim().min(1, "q (search query) is required").max(200),
});

// GET /api/shared/search — global search across leads
export async function GET(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({ q: searchParams.get("q") ?? "" });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Escape LIKE wildcards so a user searching for "100%" does not match
    // every row.
    const searchTerm = `%${parsed.data.q.replace(/[\\%_]/g, "\\$&")}%`;

    // RLS scopes this to the caller's own leads; admins see everything.
    const { data, error } = await guard.supabase
      .from("leads")
      .select("id, business_name, city, niche")
      .ilike("business_name", searchTerm)
      .limit(10);

    if (error) throw error;

    const results = ((data ?? []) as {
      id: string;
      business_name: string;
      city: string | null;
      niche: string | null;
    }[]).map((lead) => ({
      type: "lead" as const,
      id: lead.id,
      title: lead.business_name,
      subtitle: [lead.niche, lead.city].filter(Boolean).join(" · ") || undefined,
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Search GET error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
