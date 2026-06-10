import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { guard } from "@/lib/openclaw/auth";
import { lifecycleStatusSchema } from "@/lib/validators/lead";

export const runtime = "nodejs";

const querySchema = z.object({
  status: lifecycleStatusSchema.optional(),
  min_score: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

interface LeadRow {
  id: string;
  business_name: string;
  niche: string | null;
  category: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  source: string | null;
  score: number;
  lifecycle_status: string;
  priority: string | null;
  next_action: string | null;
  next_action_date: string | null;
  created_at: string;
  updated_at: string;
}

function buildLocation(row: LeadRow): string | null {
  const parts = [row.city, row.state].filter((s): s is string => Boolean(s));
  return parts.length ? parts.join(", ") : null;
}

function projectLead(row: LeadRow) {
  return {
    id: row.id,
    business_name: row.business_name,
    industry: row.niche ?? row.category ?? null,
    location: buildLocation(row),
    phone: row.phone,
    email: row.email,
    website_url: row.website,
    source: row.source,
    score: row.score,
    lifecycle_status: row.lifecycle_status,
    priority: row.priority,
    next_action: row.next_action,
    action_date: row.next_action_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(request: NextRequest) {
  const check = guard(request);
  if (!check.ok) return check.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    min_score: url.searchParams.get("min_score") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const filters = parsed.data;
  const supabase = createServiceClient();

  let query = supabase
    .from("leads")
    .select(
      "id, business_name, niche, category, city, state, phone, email, website, source, score, lifecycle_status, priority, next_action, next_action_date, created_at, updated_at"
    )
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(filters.limit);

  if (filters.status) query = query.eq("lifecycle_status", filters.status);
  if (filters.min_score !== undefined) query = query.gte("score", filters.min_score);

  const { data, error } = await query;
  if (error) {
    console.error("[openclaw] leads list error:", error);
    return NextResponse.json({ error: "Failed to load leads" }, { status: 500 });
  }

  const rows = (data as unknown as LeadRow[]) ?? [];
  return NextResponse.json({
    ok: true,
    count: rows.length,
    leads: rows.map(projectLead),
  });
}
