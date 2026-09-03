import { BUSINESS_TYPES, type BusinessType } from "./types";

/**
 * Lead → proposal handoff.
 *
 * The Proposal Generator starts from a lead the agent already owns, so this
 * module holds the parts of that handoff that are pure: which leads to
 * recommend, how to search them, and what a selected lead pre-fills. The API
 * route does the I/O; everything decided here is unit-testable and has no
 * Supabase dependency.
 */

/** Columns the picker reads. Deliberately narrow — this is a chooser, not a CRM view. */
export const LEAD_PICKER_COLUMNS =
  "id, business_name, city, state, website, email, phone, contact_name, niche, " +
  "category, score, lifecycle_status, assigned_to, next_action_date, contacted_at, updated_at";

/** Default size of the recommended list. Never "every lead in the database". */
export const LEAD_PICKER_LIMIT_DEFAULT = 8;
export const LEAD_PICKER_LIMIT_MAX = 25;

/** Shortest query worth a round trip. One character matches most of the table. */
export const LEAD_SEARCH_MIN_LENGTH = 2;

/** Lifecycle states an agent can still sell into. Mirrors /api/my/queue. */
export const WORKABLE_LIFECYCLE_STATUSES = [
  "new",
  "enriched",
  "contacted",
  "replied",
  "meeting_booked",
] as const;

/** Lifecycle states that mean the prospect has engaged with us. */
export const ENGAGED_LIFECYCLE_STATUSES = [
  "replied",
  "meeting_booked",
  "contacted",
] as const;

/** Score at or above which a lead is "hot". Same threshold the work queue uses. */
export const HOT_SCORE_THRESHOLD = 70;

/**
 * Why a lead is being recommended. Ordered by usefulness as a proposal
 * candidate: a promise to follow up today beats a prospect who replied last
 * week, which beats a high score nobody has touched.
 */
export type CandidateReason = "follow_up_due" | "engaged" | "hot" | "recent";

export const CANDIDATE_REASON_ORDER: CandidateReason[] = [
  "follow_up_due",
  "engaged",
  "hot",
  "recent",
];

export const CANDIDATE_REASON_LABELS: Record<CandidateReason, string> = {
  follow_up_due: "Follow-up due",
  engaged: "Responded",
  hot: "Hot lead",
  recent: "Recently updated",
};

/** The lead columns the picker selects, as they come back from Postgres. */
export interface LeadCandidateRow {
  id: string;
  business_name: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  niche?: string | null;
  category?: string | null;
  score?: number | null;
  lifecycle_status?: string | null;
  assigned_to?: string | null;
  next_action_date?: string | null;
  contacted_at?: string | null;
  updated_at?: string | null;
}

/** One proposal already attached to a lead, summarised for the picker. */
export interface LeadProposalRef {
  id: string;
  status: string;
  created_at: string;
  total_one_time: number;
  total_monthly: number;
}

export interface LeadProposalSummary {
  count: number;
  latest: LeadProposalRef | null;
}

/** A lead row as the picker renders it. */
export interface LeadCandidate extends LeadCandidateRow {
  reason: CandidateReason | null;
  assigned_to_name: string | null;
  proposal_count: number;
  latest_proposal: LeadProposalRef | null;
}

export interface CandidateBucket {
  reason: CandidateReason;
  rows: LeadCandidateRow[];
}

/**
 * Merge the recommendation buckets into one ranked list.
 *
 * Each bucket arrives already ordered by the database in the way that bucket
 * cares about (soonest follow-up, most recent reply, highest score), so this
 * only decides between buckets and never re-sorts inside one. A lead in more
 * than one bucket keeps the strongest reason and appears exactly once.
 */
export function rankLeadCandidates(
  buckets: CandidateBucket[],
  limit: number = LEAD_PICKER_LIMIT_DEFAULT
): Array<LeadCandidateRow & { reason: CandidateReason }> {
  const seen = new Set<string>();
  const ranked: Array<LeadCandidateRow & { reason: CandidateReason }> = [];

  for (const reason of CANDIDATE_REASON_ORDER) {
    for (const bucket of buckets) {
      if (bucket.reason !== reason) continue;
      for (const row of bucket.rows) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        ranked.push({ ...row, reason });
      }
    }
  }

  return ranked.slice(0, Math.max(0, limit));
}

/**
 * Characters that would break out of a PostgREST `or=(...)` filter, plus the
 * LIKE wildcard. Stripped rather than escaped: escaping semantics differ
 * between the filter string and the value, and a chooser search box loses
 * nothing by dropping them.
 *
 * `_` is left alone — it matches itself as well as any single character, so
 * searching an address like `first_last@example.com` still works.
 */
export function sanitizeLeadSearchTerm(raw: string): string {
  return raw
    .replace(/[,()"'\\%*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Columns a lead search looks at. Everything an agent might have to hand. */
export const LEAD_SEARCH_COLUMNS = [
  "business_name",
  "contact_name",
  "email",
  "phone",
  "city",
  "website",
] as const;

/**
 * Build the PostgREST `or` filter for a lead search. Returns null when the
 * term is too short to be worth a query.
 */
export function buildLeadSearchFilter(raw: string): string | null {
  const term = sanitizeLeadSearchTerm(raw);
  if (term.length < LEAD_SEARCH_MIN_LENGTH) return null;
  return LEAD_SEARCH_COLUMNS.map((col) => `${col}.ilike.%${term}%`).join(",");
}

/**
 * Group a flat list of proposal rows by lead. `latest` is the newest by
 * created_at — what the picker shows as "Draft proposal from Sep 3".
 */
export function summarizeProposalsByLead(
  rows: Array<{
    id: string;
    lead_id: string | null;
    status?: string | null;
    created_at?: string | null;
    total_one_time?: number | string | null;
    total_monthly?: number | string | null;
  }>
): Map<string, LeadProposalSummary> {
  const byLead = new Map<string, LeadProposalSummary>();

  for (const row of rows) {
    if (!row?.lead_id) continue;
    const ref: LeadProposalRef = {
      id: row.id,
      status: row.status ?? "draft",
      created_at: row.created_at ?? "",
      total_one_time: Number(row.total_one_time ?? 0),
      total_monthly: Number(row.total_monthly ?? 0),
    };
    const existing = byLead.get(row.lead_id);
    if (!existing) {
      byLead.set(row.lead_id, { count: 1, latest: ref });
      continue;
    }
    existing.count += 1;
    if (!existing.latest || ref.created_at > existing.latest.created_at) {
      existing.latest = ref;
    }
  }

  return byLead;
}

/** Attach proposal counts and assigned-agent names to ranked lead rows. */
export function decorateCandidates(
  rows: Array<LeadCandidateRow & { reason?: CandidateReason | null }>,
  proposals: Map<string, LeadProposalSummary>,
  agentNames: Map<string, string> = new Map()
): LeadCandidate[] {
  return rows.map((row) => {
    const summary = proposals.get(row.id);
    return {
      ...row,
      reason: row.reason ?? null,
      assigned_to_name: row.assigned_to ? (agentNames.get(row.assigned_to) ?? null) : null,
      proposal_count: summary?.count ?? 0,
      latest_proposal: summary?.latest ?? null,
    };
  });
}

/**
 * Keyword → business type. First match wins, so the specific entries come
 * before the broad ones. Only used to pre-select the dropdown; the agent can
 * always change it.
 */
const BUSINESS_TYPE_KEYWORDS: Array<[BusinessType, string[]]> = [
  ["Garage Door Contractor", ["garage door", "overhead door"]],
  ["HVAC", ["hvac", "heating", "cooling", "air condition", "furnace", "refrigeration"]],
  ["Plumbing", ["plumb"]],
  ["Electrical", ["electric"]],
  ["Roofing", ["roof"]],
  ["Landscaping / Outdoor", ["landscap", "lawn", "tree service", "hardscape", "irrigation"]],
  ["Construction / Remodeling", ["construction", "remodel", "contractor", "builder", "carpentry", "drywall", "concrete"]],
  ["Auto Dealer", ["auto", "dealer", "motors", "automotive"]],
  ["Restaurant", ["restaurant", "cafe", "pizza", "deli", "bakery", "catering", "diner", "food"]],
  ["Real Estate", ["real estate", "realty", "realtor", "property management"]],
  ["E-Commerce", ["e-commerce", "ecommerce", "online store"]],
  ["Retail", ["retail", "boutique", "storefront"]],
  ["Health & Wellness", ["health", "wellness", "spa", "salon", "fitness", "gym", "dental", "dentist", "chiro", "medical", "therapy"]],
  ["Professional Services", ["law", "attorney", "legal", "account", "cpa", "insurance", "consult", "agency", "marketing"]],
  ["Home Services", ["cleaning", "janitorial", "pest", "handyman", "painting", "flooring", "home service", "moving", "restoration"]],
];

/** The dropdown's existing default, used when nothing matches. */
export const DEFAULT_BUSINESS_TYPE: BusinessType = "Home Services";

/**
 * Best-effort business type for a lead, read off the CRM fields we already
 * have. Never guesses services or prices — only the industry label.
 */
export function businessTypeForLead(lead: LeadCandidateRow): BusinessType {
  const haystack = [lead.niche, lead.category, lead.business_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!haystack.trim()) return DEFAULT_BUSINESS_TYPE;

  // An exact match on an existing dropdown value wins over any keyword rule.
  for (const type of BUSINESS_TYPES) {
    if (haystack.includes(type.toLowerCase())) return type;
  }

  for (const [type, keywords] of BUSINESS_TYPE_KEYWORDS) {
    if (keywords.some((kw) => haystack.includes(kw))) return type;
  }

  return DEFAULT_BUSINESS_TYPE;
}

/**
 * What selecting a lead puts into the builder.
 *
 * Client identity and contact details only. Services, scope and pricing are
 * deliberately absent: those are the agent's call on every proposal, and
 * pre-selecting them is how a generator starts sending scope nobody chose.
 */
export interface ProposalPrefill {
  lead_id: string;
  client_name: string;
  business_type: BusinessType;
  website_url: string;
  recipient_name: string;
  recipient_email: string;
  /** Shown as context on the linked-lead banner; proposals store no phone. */
  phone: string;
}

export function buildProposalPrefill(lead: LeadCandidateRow): ProposalPrefill {
  return {
    lead_id: lead.id,
    client_name: lead.business_name?.trim() ?? "",
    business_type: businessTypeForLead(lead),
    website_url: lead.website?.trim() ?? "",
    recipient_name: lead.contact_name?.trim() ?? "",
    recipient_email: lead.email?.trim() ?? "",
    phone: lead.phone?.trim() ?? "",
  };
}
