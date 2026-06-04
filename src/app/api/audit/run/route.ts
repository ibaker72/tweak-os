import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { extractFromUrl, fetchPageSpeed } from "@/lib/audits/extract";
import { generateAuditFromSite } from "@/lib/audits/generate";

const inputSchema = z.object({
  url: z.string().min(1, "url is required"),
  lead_id: z.string().uuid().optional(),
});

export const maxDuration = 60;

// POST /api/audit/run — fetch + analyze a URL and persist the audit
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, lead_id } = inputSchema.parse(body);

    const supabase = await createClient();

    const [site, pageSpeed] = await Promise.all([
      extractFromUrl(url),
      fetchPageSpeed(url),
    ]);

    const audit = await generateAuditFromSite(site, pageSpeed);

    const { data: inserted, error: insertErr } = await supabase
      .from("lead_audits")
      .insert({
        url: site.url,
        audit_json: audit,
        opportunity_grade: audit.opportunity_grade,
        overall_score: audit.overall_score,
        lead_id: lead_id ?? null,
      })
      .select("id, url, audit_json, opportunity_grade, overall_score, lead_id, created_at")
      .single();

    if (insertErr) {
      console.error("Audit insert error:", insertErr);
    }

    return NextResponse.json({
      success: true,
      audit,
      site,
      pageSpeed,
      record: inserted ?? null,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Audit run error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Audit failed" },
      { status: 500 }
    );
  }
}
