import type { EnrichmentResult, ScoreResult, ScoreBreakdown } from "./types";

// NJ/NY metro area states
const LOCAL_STATES = ["NJ", "NY", "CT", "PA"];

// Sweet spot industries for Tweak & Build
const SWEET_SPOT_INDUSTRIES = [
  "e-commerce",
  "ecommerce",
  "saas",
  "health tech",
  "healthtech",
  "healthcare",
  "logistics",
  "professional services",
  "legal",
  "consulting",
  "accounting",
  "real estate",
  "restaurant",
  "fitness",
  "medical",
  "dental",
];

// Platforms that signal a prime candidate for custom rebuild
const REBUILD_PLATFORMS = ["Wix", "Squarespace", "WordPress", "GoDaddy", "Webflow"];

// Modern stacks that suggest existing technical capability
const MODERN_STACKS = ["Next.js", "React", "Vue.js", "Angular"];

/**
 * Tweak & Build specific scoring engine.
 * Rates leads 0-100 based on how likely they are to become a client.
 */
export function scoreLead(
  enrichment: EnrichmentResult,
  lead: {
    website: string | null;
    niche: string | null;
    city: string | null;
    state: string | null;
    google_rating?: number | null;
    google_review_count?: number | null;
  }
): ScoreResult {
  let score = 0;
  const reasons: string[] = [];
  const breakdown: ScoreBreakdown = {};

  if (!lead.website) {
    reasons.push("+0: No website listed");
    return { score: 0, reasons, breakdown };
  }

  // --- Website on Wix/Squarespace/WordPress.com (+20) ---
  const hasRebuildPlatform = enrichment.tech_stack.some((t) =>
    REBUILD_PLATFORMS.some((p) => t.toLowerCase().includes(p.toLowerCase()))
  );
  if (hasRebuildPlatform) {
    const platform = enrichment.tech_stack.find((t) =>
      REBUILD_PLATFORMS.some((p) => t.toLowerCase().includes(p.toLowerCase()))
    );
    score += 20;
    breakdown["Rebuild platform detected"] = 20;
    reasons.push(`+20: Website built on ${platform} — prime candidate for custom rebuild`);
  }

  // --- Website is slow (>3s response time) (+10) ---
  if (enrichment.page_load_time_ms && enrichment.page_load_time_ms > 3000) {
    score += 10;
    breakdown["Slow website"] = 10;
    reasons.push(
      `+10: Website is slow (${(enrichment.page_load_time_ms / 1000).toFixed(1)}s response time)`
    );
  }

  // --- No SSL certificate (+10) ---
  if (!enrichment.has_ssl) {
    score += 10;
    breakdown["No SSL"] = 10;
    reasons.push("+10: No SSL certificate — security red flag, easy sell");
  }

  // --- Not mobile responsive (+15) ---
  if (!enrichment.is_mobile_responsive) {
    score += 15;
    breakdown["Not mobile responsive"] = 15;
    reasons.push("+15: Website is not mobile responsive — major issue");
  }

  // --- Revenue signals (+15) ---
  if (enrichment.has_ecommerce) {
    score += 15;
    breakdown["Revenue signals"] = 15;
    reasons.push("+15: Has e-commerce/revenue signals — can afford services");
  }

  // --- High Google rating with 50+ reviews (+10) ---
  if (
    lead.google_rating &&
    lead.google_rating >= 4.0 &&
    lead.google_review_count &&
    lead.google_review_count >= 50
  ) {
    score += 10;
    breakdown["High Google rating"] = 10;
    reasons.push(
      `+10: High Google rating (${lead.google_rating}/5 with ${lead.google_review_count} reviews) — established business`
    );
  }

  // --- No social media presence (+5) ---
  const socialCount = [
    enrichment.facebook,
    enrichment.instagram,
    enrichment.linkedin,
    enrichment.twitter,
  ].filter(Boolean).length;
  if (socialCount === 0) {
    score += 5;
    breakdown["No social media"] = 5;
    reasons.push("+5: No social media presence — potential for broader digital services");
  }

  // --- Has a blog (active content) (-5) ---
  if (enrichment.has_blog) {
    score -= 5;
    breakdown["Has blog"] = -5;
    reasons.push("-5: Has an active blog — already investing in digital");
  }

  // --- Website built with modern stack (-15) ---
  const hasModernStack = enrichment.tech_stack.some((t) =>
    MODERN_STACKS.some((m) => t.toLowerCase().includes(m.toLowerCase()))
  );
  if (hasModernStack && !hasRebuildPlatform) {
    score -= 15;
    breakdown["Modern tech stack"] = -15;
    reasons.push("-15: Website built with modern stack — probably has technical capability");
  }

  // --- Located in NJ/NY metro area (+10) ---
  if (lead.state && LOCAL_STATES.includes(lead.state.toUpperCase())) {
    score += 10;
    breakdown["Local client"] = 10;
    reasons.push(`+10: Located in ${lead.state} — local client, easier to close`);
  }

  // --- Industry in sweet spot (+10) ---
  const nicheLC = (lead.niche || "").toLowerCase();
  const isSweet = SWEET_SPOT_INDUSTRIES.some(
    (ind) => nicheLC.includes(ind) || ind.includes(nicheLC)
  );
  if (isSweet && nicheLC) {
    score += 10;
    breakdown["Sweet spot industry"] = 10;
    reasons.push(`+10: Industry "${lead.niche}" is in our sweet spot`);
  }

  // --- No email found on website (+5) ---
  if (enrichment.emails.length === 0) {
    score += 5;
    breakdown["No email on website"] = 5;
    reasons.push("+5: No email found on website — poor online presence");
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  return { score, reasons, breakdown };
}

export function getScoreTier(
  score: number
): "hot" | "warm" | "cold" {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

export function getScoreColor(score: number): string {
  if (score >= 70) return "text-red-500"; // Hot = red/urgent
  if (score >= 40) return "text-orange-500"; // Warm = orange
  return "text-blue-500"; // Cold = blue
}

export function getScoreBgColor(score: number): string {
  if (score >= 70) return "bg-red-500/10 border-red-500/20";
  if (score >= 40) return "bg-orange-500/10 border-orange-500/20";
  return "bg-blue-500/10 border-blue-500/20";
}
