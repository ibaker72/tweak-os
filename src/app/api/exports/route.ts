import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { leadFilterSchema } from "@/lib/validators/lead";
import { leadsToCSV } from "@/lib/leads/csv";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);

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
      query = query.ilike("niche", `%${filters.niche}%`);
    }
    if (filters.min_score !== undefined) {
      query = query.gte("score", filters.min_score);
    }

    query = query.order(filters.sort_by, {
      ascending: filters.sort_order === "asc",
    });

    const { data, error } = await query;
    if (error) throw error;

    const exportType = searchParams.export_type;

    if (exportType === "outreach") {
      // Export outreach emails as batch
      const outreachData = (data ?? [])
        .filter((lead) => lead.outreach?.cold_email)
        .map((lead) => ({
          business_name: lead.business_name,
          email: lead.email || lead.email_1,
          cold_email: lead.outreach?.cold_email,
          linkedin_dm: lead.outreach?.linkedin_dm,
          follow_up_email: lead.outreach?.follow_up_email,
          offer_angle: lead.outreach?.offer_angle,
        }));

      const csv = leadsToCSV(outreachData);

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="outreach-export-${Date.now()}.csv"`,
        },
      });
    }

    // Default: full lead export
    const exportFields = (data ?? []).map((lead) => ({
      business_name: lead.business_name,
      website: lead.website,
      email: lead.email || lead.email_1,
      phone: lead.phone || lead.phone_1,
      city: lead.city,
      state: lead.state,
      industry: lead.niche,
      category: lead.category,
      source: lead.source,
      lifecycle_status: lead.lifecycle_status,
      enrichment_status: lead.enrichment_status,
      score: lead.score,
      tech_stack: (lead.tech_stack || []).join(", "),
      has_ssl: lead.has_ssl,
      is_mobile_responsive: lead.is_mobile_responsive,
      has_blog: lead.has_blog,
      has_ecommerce: lead.has_ecommerce,
      page_load_time_ms: lead.page_load_time_ms,
      google_rating: lead.google_rating,
      google_review_count: lead.google_review_count,
      facebook: lead.social_links?.facebook || lead.facebook,
      instagram: lead.social_links?.instagram || lead.instagram,
      linkedin: lead.social_links?.linkedin || lead.linkedin,
      twitter: lead.social_links?.twitter || lead.twitter,
      pain_points: lead.outreach?.pain_points?.join("; "),
      offer_angle: lead.outreach?.offer_angle || lead.offer_angle,
      cold_email: lead.outreach?.cold_email,
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
