import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import {
  buildLeadSearchFilter,
  decorateCandidates,
  rankLeadCandidates,
  summarizeProposalsByLead,
  CANDIDATE_REASON_ORDER,
  ENGAGED_LIFECYCLE_STATUSES,
  HOT_SCORE_THRESHOLD,
  LEAD_PICKER_COLUMNS,
  LEAD_PICKER_LIMIT_DEFAULT,
  LEAD_PICKER_LIMIT_MAX,
  WORKABLE_LIFECYCLE_STATUSES,
  type CandidateBucket,
  type CandidateReason,
  type LeadCandidateRow,
} from "@/lib/proposals/lead-candidates";

/**
 * GET /api/proposals/leads — the "Start from a Lead" picker.
 *
 * Two modes, both bounded:
 *   no `q`  → a short recommended list built from the same signals the work
 *             queue uses (follow-up due, replied, hot, recently updated);
 *   with `q` → a server-side search across the fields an agent actually has to
 *             hand (name, contact, phone, email, city, website).
 *
 * There is no `assigned_to = me` filter anywhere in here, deliberately. RLS
 * scopes `leads` to the caller's assigned rows, so an agent sees their own
 * leads and an admin sees everything because the database says so, not because
 * this file remembered a WHERE clause. The same is true of the proposal counts
 * below.
 */

const FOCUS_VALUES = ["recommended", "follow_up_due", "engaged", "hot"] as const;

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /** Load one specific lead — used when the page is opened as ?lead_id=... */
  lead_id: z.string().uuid().optional(),
  focus: z.enum(FOCUS_VALUES).default("recommended"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LEAD_PICKER_LIMIT_MAX)
    .default(LEAD_PICKER_LIMIT_DEFAULT),
});

function activeLeads(supabase: SupabaseClient) {
  return supabase
    .from("leads")
    .select(LEAD_PICKER_COLUMNS)
    .is("archived_at", null)
    .is("deleted_at", null);
}

export async function GET(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? undefined,
    lead_id: request.nextUrl.searchParams.get("lead_id") ?? undefined,
    focus: request.nextUrl.searchParams.get("focus") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { focus, limit } = parsed.data;
  const supabase = guard.supabase;

  try {
    const searchFilter = parsed.data.q ? buildLeadSearchFilter(parsed.data.q) : null;

    let rows: Array<LeadCandidateRow & { reason: CandidateReason | null }>;
    let mode: "search" | "recommended" | "single";

    if (parsed.data.lead_id) {
      mode = "single";
      const { data, error } = await supabase
        .from("leads")
        .select(LEAD_PICKER_COLUMNS)
        .eq("id", parsed.data.lead_id)
        .maybeSingle();
      if (error) throw error;
      rows = data ? [{ ...(data as unknown as LeadCandidateRow), reason: null }] : [];
    } else if (searchFilter) {
      mode = "search";
      const { data, error } = await activeLeads(supabase)
        .or(searchFilter)
        .order("score", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      rows = ((data ?? []) as unknown as LeadCandidateRow[]).map((row) => ({ ...row, reason: null }));
    } else if (parsed.data.q) {
      // Present but too short to search on — say so rather than silently
      // falling back to the recommended list under a search box.
      mode = "search";
      rows = [];
    } else {
      mode = "recommended";
      rows = await recommendedLeads(supabase, focus, limit);
    }

    const ids = rows.map((row) => row.id);
    const [proposals, agentNames] = await Promise.all([
      loadProposalSummaries(supabase, ids),
      loadAgentNames(supabase, rows),
    ]);

    return NextResponse.json({
      leads: decorateCandidates(rows, proposals, agentNames),
      mode,
      limit,
      focus,
    });
  } catch (err) {
    console.error("Proposal lead picker error:", err);
    return NextResponse.json({ error: "Failed to load leads" }, { status: 500 });
  }
}

/**
 * The recommended list. Each bucket is its own small, ordered, limited query;
 * `rankLeadCandidates` merges them and drops duplicates. Four bounded queries
 * beats one unbounded scan of the leads table.
 */
async function recommendedLeads(
  supabase: SupabaseClient,
  focus: (typeof FOCUS_VALUES)[number],
  limit: number
): Promise<Array<LeadCandidateRow & { reason: CandidateReason }>> {
  const today = new Date().toISOString().split("T")[0];
  const workable = [...WORKABLE_LIFECYCLE_STATUSES];

  const wanted: CandidateReason[] =
    focus === "recommended" ? CANDIDATE_REASON_ORDER : [focus];

  const queries: Array<Promise<CandidateBucket>> = [];

  const run = async (
    reason: CandidateReason,
    builder: PromiseLike<{ data: unknown; error: unknown }>
  ): Promise<CandidateBucket> => {
    const { data, error } = await builder;
    if (error) throw error;
    return { reason, rows: (data ?? []) as unknown as LeadCandidateRow[] };
  };

  if (wanted.includes("follow_up_due")) {
    queries.push(
      run(
        "follow_up_due",
        activeLeads(supabase)
          .not("next_action_date", "is", null)
          .lte("next_action_date", today)
          .in("lifecycle_status", workable)
          .order("next_action_date", { ascending: true })
          .limit(limit)
      )
    );
  }

  if (wanted.includes("engaged")) {
    queries.push(
      run(
        "engaged",
        activeLeads(supabase)
          .in("lifecycle_status", [...ENGAGED_LIFECYCLE_STATUSES])
          .order("updated_at", { ascending: false })
          .limit(limit)
      )
    );
  }

  if (wanted.includes("hot")) {
    queries.push(
      run(
        "hot",
        activeLeads(supabase)
          .gte("score", HOT_SCORE_THRESHOLD)
          .in("lifecycle_status", ["new", "enriched"])
          .order("score", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(limit)
      )
    );
  }

  if (wanted.includes("recent")) {
    queries.push(
      run(
        "recent",
        activeLeads(supabase)
          .in("lifecycle_status", workable)
          .order("updated_at", { ascending: false })
          .limit(limit)
      )
    );
  }

  return rankLeadCandidates(await Promise.all(queries), limit);
}

/** Existing proposals for the listed leads, so duplicates are visible up front. */
async function loadProposalSummaries(supabase: SupabaseClient, leadIds: string[]) {
  if (leadIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("proposals")
    .select("id, lead_id, status, created_at, total_one_time, total_monthly")
    .in("lead_id", leadIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return summarizeProposalsByLead(
    (data ?? []) as unknown as Parameters<typeof summarizeProposalsByLead>[0]
  );
}

/** Assigned-agent display names, via the name-only teammate directory view. */
async function loadAgentNames(supabase: SupabaseClient, rows: LeadCandidateRow[]) {
  const ids = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean))] as string[];
  if (ids.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("agent_directory")
    .select("id, display_name")
    .in("id", ids);
  // A missing directory row is cosmetic — the picker still works without a name.
  if (error) return new Map<string, string>();

  return new Map(
    ((data ?? []) as unknown as { id: string; display_name: string | null }[])
      .filter((a) => a.display_name)
      .map((a) => [a.id, a.display_name as string])
  );
}
