import type { EnrichmentResult, ScoreResult } from "./types";

/**
 * Transparent, rule-based lead scoring.
 * Each rule adds or subtracts points and records a reason.
 * Total score is clamped to 0–100.
 */
export function scoreLead(
  enrichment: EnrichmentResult,
  lead: { website: string | null; niche: string | null }
): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  // --- Website present ---
  if (lead.website) {
    score += 10;
    reasons.push("+10: Has a website");
  } else {
    reasons.push("+0: No website listed");
    return { score: 0, reasons };
  }

  // --- Page title found (site is live) ---
  if (enrichment.page_title) {
    score += 10;
    reasons.push("+10: Website is live (page title found)");
  } else {
    score -= 5;
    reasons.push("-5: Website may be down (no page title)");
  }

  // --- Email found ---
  if (enrichment.emails.length > 0) {
    score += 20;
    reasons.push(`+20: Email found (${enrichment.emails[0]})`);
  } else {
    reasons.push("+0: No email found");
  }

  // --- Multiple emails (more contact options) ---
  if (enrichment.emails.length >= 2) {
    score += 5;
    reasons.push("+5: Multiple emails found");
  }

  // --- Phone found ---
  if (enrichment.phones.length > 0) {
    score += 15;
    reasons.push("+15: Phone number found");
  } else {
    reasons.push("+0: No phone number found");
  }

  // --- Contact page found ---
  if (enrichment.contact_page) {
    score += 10;
    reasons.push("+10: Contact page detected");
  }

  // --- Social presence ---
  const socialCount = [
    enrichment.facebook,
    enrichment.instagram,
    enrichment.linkedin,
  ].filter(Boolean).length;

  if (socialCount >= 2) {
    score += 15;
    reasons.push(`+15: Strong social presence (${socialCount} profiles)`);
  } else if (socialCount === 1) {
    score += 8;
    reasons.push("+8: Some social presence (1 profile)");
  } else {
    reasons.push("+0: No social profiles found");
  }

  // --- LinkedIn is especially valuable ---
  if (enrichment.linkedin) {
    score += 5;
    reasons.push("+5: LinkedIn profile found (B2B signal)");
  }

  // --- Niche specified ---
  if (lead.niche) {
    score += 5;
    reasons.push("+5: Niche/industry identified");
  }

  // --- No contact info at all ---
  if (
    enrichment.emails.length === 0 &&
    enrichment.phones.length === 0 &&
    !enrichment.contact_page
  ) {
    score -= 10;
    reasons.push("-10: No contact information found at all");
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  return { score, reasons };
}
