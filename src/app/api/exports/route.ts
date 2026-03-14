import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { leadFilterSchema } from "@/lib/validators/lead";
import { leadsToCSV } from "@/lib/leads/csv";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);

    // Parse filters (but override pagination to get all matching)
    const filters = leadFilterSchema.parse({
      ...searchParams,
      page: 1,
      per_page: 100,
    });

    let query = supabase.from("leads").select("*");

    if (filters.search) {
      query = query.or(
        `business_name.ilike.%${filters.search}%,city.ilike.%${filters.search}%,niche.ilike.%${filters.search}%`
      );
    }
    if (filters.lifecycle_status) {
      query = query.eq("lifecycle_status", filters.lifecycle_status);
    }
    if (filters.enrichment_status) {
      query = query.eq("enrichment_status", filters.enrichment_status);
    }
    if (filters.niche) {
      query = query.eq("niche", filters.niche);
    }
    if (filters.min_score !== undefined) {
      query = query.gte("score", filters.min_score);
    }

    query = query.order(filters.sort_by, {
      ascending: filters.sort_order === "asc",
    });

    const { data, error } = await query;
    if (error) throw error;

    const exportFields = (data ?? []).map((lead) => ({
      business_name: lead.business_name,
      city: lead.city,
      state: lead.state,
      website: lead.website,
      source: lead.source,
      niche: lead.niche,
      lifecycle_status: lead.lifecycle_status,
      enrichment_status: lead.enrichment_status,
      page_title: lead.page_title,
      email_1: lead.email_1,
      email_2: lead.email_2,
      phone_1: lead.phone_1,
      phone_2: lead.phone_2,
      contact_page: lead.contact_page,
      facebook: lead.facebook,
      instagram: lead.instagram,
      linkedin: lead.linkedin,
      score: lead.score,
      pain_point_1: lead.pain_point_1,
      pain_point_2: lead.pain_point_2,
      offer_angle: lead.offer_angle,
      suggested_first_line: lead.suggested_first_line,
      manual_notes: lead.manual_notes,
    }));

    const csv = leadsToCSV(exportFields);

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="leads-export-${Date.now()}.csv"`,
      },
    });
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json(
      { error: "Export failed" },
      { status: 500 }
    );
  }
}
