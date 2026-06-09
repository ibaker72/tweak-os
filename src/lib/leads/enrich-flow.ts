import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, EnrichmentResult, OutreachData, ScoreResult } from "./types";
import { enrichWebsite } from "./enrichment";
import { scoreLead } from "./scoring";
import { generateOutreach } from "./outreach";
import { generateInsights } from "./insights";
import { guessIndustryFromName } from "./industry-guess";
import { searchGooglePlaces, getPlaceDetails } from "./google-places";
import {
  updateLeadEnrichment,
  updateLeadEnrichmentLite,
  markLeadEnrichmentFailed,
} from "./mutations";

const NJ_SOURCE_LABEL = "NJ Business Records";

export type EnrichOutcomeStatus = "complete" | "failed";

export interface EnrichOutcome {
  status: EnrichOutcomeStatus;
  score?: number;
  contact_status?: string;
  online_presence?: string;
  enrichment_summary?: string;
  outreach?: OutreachData | null;
  error?: string;
}

/**
 * Single source of truth for enriching one lead. Both /api/enrich and
 * /api/enrich-bulk call this so NJ "no-website" leads behave identically
 * regardless of how enrichment was triggered.
 */
export async function enrichOneLead(
  supabase: SupabaseClient,
  lead: Lead
): Promise<EnrichOutcome> {
  if (!lead.business_name || !lead.business_name.trim()) {
    await markLeadEnrichmentFailed(supabase, lead.id, "business_name is required");
    return { status: "failed", error: "business_name is required" };
  }

  // 1) Website path — preserves existing behavior for non-NJ and NJ-with-site leads.
  if (lead.website) {
    return enrichWithWebsite(supabase, lead, lead.website);
  }

  // 2) No website — try Google Places to resolve a website + contact info.
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    const msg = "Missing GOOGLE_PLACES_API_KEY";
    await markLeadEnrichmentFailed(supabase, lead.id, msg);
    return { status: "failed", error: msg };
  }

  let placeWebsite: string | null = null;
  let placePhone: string | null = null;
  let placeAddress: string | null = null;
  let placeRating: number | null = null;
  let placeReviewCount: number | null = null;
  let placeId: string | null = null;

  try {
    const placesResults = await searchGooglePlaces({
      niche: lead.niche ?? "",
      city: lead.city ?? "",
      state: lead.state ?? "NJ",
      keyword: lead.business_name,
      source: "google_places",
    });
    // Pick the best match by name similarity. If nothing matches well,
    // we still continue to the no-match branch — Places returning 0 hits
    // is NOT a failure, just an absence of public profile.
    const best = pickBestPlaceMatch(placesResults, lead.business_name);
    if (best) {
      placeAddress = best.address ?? null;
      placeRating = best.google_rating;
      placeReviewCount = best.google_review_count;
      placeId = best.google_place_id;
      try {
        const details = await getPlaceDetails(best.google_place_id);
        placeWebsite = details.website;
        placePhone = details.phone;
      } catch {
        // Place Details may fail (e.g. quota); still useful with the search-level info.
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Google Places API error";
    await markLeadEnrichmentFailed(supabase, lead.id, msg);
    return { status: "failed", error: msg };
  }

  // 2a) Places returned a website — fall through to the website path with hydrated URL.
  if (placeWebsite) {
    return enrichWithWebsite(supabase, lead, placeWebsite, {
      phone: placePhone,
      address: placeAddress,
      google_rating: placeRating,
      google_review_count: placeReviewCount,
      google_place_id: placeId,
    });
  }

  // 2b) No website found — score in startup mode and persist a "not found" result.
  const scoreResult = scoreLead(
    {
      page_title: null,
      emails: [],
      phones: placePhone ? [placePhone] : [],
      contact_page: null,
      facebook: null,
      instagram: null,
      linkedin: null,
      twitter: null,
      tech_stack: [],
      has_ssl: false,
      is_mobile_responsive: false,
      has_blog: false,
      has_ecommerce: false,
      page_load_time_ms: null,
      performance_grade: null,
      last_modified: null,
    },
    {
      business_name: lead.business_name,
      source: lead.source,
      website: null,
      niche: lead.niche,
      city: lead.city,
      state: lead.state,
      address: placeAddress ?? lead.address,
      source_filing_date: lead.source_filing_date,
      created_at: lead.created_at,
      google_rating: placeRating,
      google_review_count: placeReviewCount,
    }
  );

  const niche = lead.niche || guessIndustryFromName(lead.business_name);
  const enrichmentSummary = placePhone || placeAddress
    ? "Found a Google Places profile but no public website yet."
    : "No public website or contact profile found during enrichment. This may be a newly formed business with no online presence yet.";

  // Outreach: always attempt for NJ-source leads; otherwise gate on score.
  const shouldOutreach =
    process.env.ANTHROPIC_API_KEY &&
    (lead.source === NJ_SOURCE_LABEL || scoreResult.score >= 40);
  let outreach: OutreachData | null = null;
  if (shouldOutreach) {
    try {
      // Build a synthetic lead view so the outreach branch sees the latest data.
      const leadForOutreach: Lead = {
        ...lead,
        phone: placePhone ?? lead.phone,
        address: placeAddress ?? lead.address,
        niche: niche ?? lead.niche,
        online_presence: "none_found",
      };
      outreach = await generateOutreach(leadForOutreach);
    } catch (err) {
      // Outreach failure isn't fatal — log and continue. The lead is still useful.
      console.error("Launch-kit outreach failed:", err);
    }
  }

  try {
    await updateLeadEnrichmentLite(supabase, lead.id, scoreResult, outreach, {
      contact_status: placePhone || placeAddress ? "partial" : "not_found",
      online_presence: placePhone || placeAddress ? "minimal" : "none_found",
      enrichment_summary: enrichmentSummary,
      niche: niche ?? null,
      phone: placePhone,
      address: placeAddress,
      google_rating: placeRating,
      google_review_count: placeReviewCount,
      google_place_id: placeId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Database update failed";
    await markLeadEnrichmentFailed(supabase, lead.id, msg);
    return { status: "failed", error: msg };
  }

  return {
    status: "complete",
    score: scoreResult.score,
    contact_status: placePhone || placeAddress ? "partial" : "not_found",
    online_presence: placePhone || placeAddress ? "minimal" : "none_found",
    enrichment_summary: enrichmentSummary,
    outreach,
  };
}

async function enrichWithWebsite(
  supabase: SupabaseClient,
  lead: Lead,
  websiteUrl: string,
  hydrated?: {
    phone?: string | null;
    address?: string | null;
    google_rating?: number | null;
    google_review_count?: number | null;
    google_place_id?: string | null;
  }
): Promise<EnrichOutcome> {
  let enrichmentResult: EnrichmentResult;
  try {
    enrichmentResult = await enrichWebsite(websiteUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Website enrichment failed";
    await markLeadEnrichmentFailed(supabase, lead.id, msg);
    return { status: "failed", error: msg };
  }

  const scoreResult: ScoreResult = scoreLead(enrichmentResult, {
    business_name: lead.business_name,
    source: lead.source,
    website: websiteUrl,
    niche: lead.niche,
    city: lead.city,
    state: lead.state,
    address: lead.address,
    source_filing_date: lead.source_filing_date,
    created_at: lead.created_at,
    google_rating: hydrated?.google_rating ?? lead.google_rating,
    google_review_count: hydrated?.google_review_count ?? lead.google_review_count,
  });

  const shouldOutreach =
    process.env.ANTHROPIC_API_KEY &&
    (lead.source === NJ_SOURCE_LABEL || scoreResult.score >= 40);
  let outreach: OutreachData | null = null;
  if (shouldOutreach) {
    try {
      outreach = await generateOutreach(
        { ...lead, website: websiteUrl } as Lead,
        enrichmentResult
      );
    } catch (err) {
      console.error("Outreach generation failed:", err);
    }
  }

  // Rule-based fallback for outreach when AI is unavailable
  if (!outreach) {
    const insights = generateInsights(enrichmentResult, {
      business_name: lead.business_name,
      niche: lead.niche,
      website: websiteUrl,
    });
    outreach = {
      pain_points: [insights.pain_point_1, insights.pain_point_2],
      offer_angle: insights.offer_angle,
      cold_email: insights.suggested_first_line,
      linkedin_dm: "",
      follow_up_email: "",
    };
  }

  const niche = lead.niche || guessIndustryFromName(lead.business_name);
  const contactStatus =
    enrichmentResult.emails.length || enrichmentResult.phones.length || hydrated?.phone
      ? "found"
      : "not_found";
  const socialCount = [
    enrichmentResult.facebook,
    enrichmentResult.instagram,
    enrichmentResult.linkedin,
    enrichmentResult.twitter,
  ].filter(Boolean).length;
  const onlinePresence =
    enrichmentResult.page_title && socialCount >= 2
      ? "strong"
      : enrichmentResult.page_title
        ? "moderate"
        : "minimal";

  // If Places hydrated extra fields, fold them in before saving.
  const enrichmentWithHydration: EnrichmentResult = {
    ...enrichmentResult,
    phones: hydrated?.phone
      ? Array.from(new Set([hydrated.phone, ...enrichmentResult.phones]))
      : enrichmentResult.phones,
  };

  try {
    // Persist Google Places hydration fields separately when present.
    if (hydrated?.google_place_id || hydrated?.address) {
      const placeUpdate: Record<string, unknown> = {};
      if (hydrated.google_place_id) placeUpdate.google_place_id = hydrated.google_place_id;
      if (hydrated.address) placeUpdate.address = hydrated.address;
      if (hydrated.google_rating !== undefined && hydrated.google_rating !== null) {
        placeUpdate.google_rating = hydrated.google_rating;
      }
      if (hydrated.google_review_count !== undefined && hydrated.google_review_count !== null) {
        placeUpdate.google_review_count = hydrated.google_review_count;
      }
      placeUpdate.website = websiteUrl;
      if (Object.keys(placeUpdate).length) {
        await supabase.from("leads").update(placeUpdate).eq("id", lead.id);
      }
    }

    await updateLeadEnrichment(
      supabase,
      lead.id,
      enrichmentWithHydration,
      scoreResult,
      outreach,
      {
        contact_status: contactStatus,
        online_presence: onlinePresence,
        niche: niche ?? null,
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Database update failed";
    await markLeadEnrichmentFailed(supabase, lead.id, msg);
    return { status: "failed", error: msg };
  }

  return {
    status: "complete",
    score: scoreResult.score,
    contact_status: contactStatus,
    online_presence: onlinePresence,
    outreach,
  };
}

function pickBestPlaceMatch<T extends { business_name: string }>(
  results: T[],
  targetName: string
): T | null {
  if (!results.length) return null;
  const target = normalize(targetName);
  // Prefer exact normalized-name match; otherwise first result.
  const exact = results.find((r) => normalize(r.business_name) === target);
  if (exact) return exact;
  // Fall back to containment in either direction (handles "LLC" suffixes etc.).
  const partial = results.find((r) => {
    const n = normalize(r.business_name);
    return n.includes(target) || target.includes(n);
  });
  return partial ?? results[0];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|company)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
