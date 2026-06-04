import Anthropic from "@anthropic-ai/sdk";
import type { AuditJson, ExtractedSiteData, OpportunityGrade, PageSpeedScores } from "./types";

const AUDIT_MODEL = "claude-sonnet-4-20250514";
const AUDIT_MAX_TOKENS = 1000;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

const SYSTEM_PROMPT =
  "You are an expert SEO and conversion analyst for a web agency called Tweak & Build. You analyze local business and dealership websites. Always respond with valid JSON only. No markdown, no explanation, just the JSON object.";

function buildUserPrompt(
  site: ExtractedSiteData,
  pageSpeed: PageSpeedScores
): string {
  const summary = [
    `URL: ${site.url}`,
    `Title: ${site.title ?? "(none)"}`,
    `Meta description: ${site.meta_description ?? "(none)"}`,
    `Meta keywords: ${site.meta_keywords ?? "(none)"}`,
    `H1 tags: ${site.h1_tags.length ? site.h1_tags.join(" | ") : "(none)"}`,
    `Canonical: ${site.canonical ?? "(none)"}`,
    `OG title: ${site.og_title ?? "(none)"}`,
    `OG description: ${site.og_description ?? "(none)"}`,
    `JSON-LD schema types found: ${site.json_ld_types.length ? site.json_ld_types.join(", ") : "(none)"}`,
    `sitemap.xml present: ${site.has_sitemap ? "yes" : "no"}`,
    `robots.txt present: ${site.has_robots_txt ? "yes" : "no"}`,
    `Contact/quote/booking link present: ${site.has_contact_page ? "yes" : "no"}`,
    `Fetch error: ${site.fetch_error ?? "(none)"}`,
    "",
    "PageSpeed Insights:",
    `  Performance (avg of mobile+desktop): ${pageSpeed.performance ?? "n/a"}`,
    `  Mobile Performance: ${pageSpeed.mobile_performance ?? "n/a"}`,
    `  Desktop Performance: ${pageSpeed.desktop_performance ?? "n/a"}`,
    `  SEO score: ${pageSpeed.seo ?? "n/a"}`,
    `  Accessibility: ${pageSpeed.accessibility ?? "n/a"}`,
    `  FCP (ms): ${pageSpeed.fcp ?? "n/a"}`,
    `  LCP (ms): ${pageSpeed.lcp ?? "n/a"}`,
    `  CLS: ${pageSpeed.cls ?? "n/a"}`,
    `  PageSpeed error: ${pageSpeed.error ?? "(none)"}`,
  ].join("\n");

  return `${summary}

Based on this data, return a JSON audit with exactly this shape:
{
  "overall_score": number 0-100,
  "seo_score": number 0-100,
  "speed_score": number 0-100 (use PageSpeed data if available),
  "mobile_score": number 0-100 (use PageSpeed mobile if available),
  "conversion_score": number 0-100,
  "opportunity_grade": "A+" | "A" | "B" | "C",
  "missing_pages": string[],
  "missing_schema": string[],
  "gbp_issues": string[],
  "competitor_gaps": string[],
  "top_3_recommendations": string[],
  "estimated_monthly_leads_lost": number,
  "summary": string (2 sentences max)
}
Opportunity grade: A+ = score 85+, A = 70-84, B = 50-69, C = below 50`;
}

function gradeFromScore(score: number): OpportunityGrade {
  if (score >= 85) return "A+";
  if (score >= 70) return "A";
  if (score >= 50) return "B";
  return "C";
}

function clampScore(n: unknown, fallback: number): number {
  const num = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function stripFences(s: string): string {
  return s.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
}

export async function generateAuditFromSite(
  site: ExtractedSiteData,
  pageSpeed: PageSpeedScores
): Promise<AuditJson> {
  const client = getClient();
  const response = await client.messages.create({
    model: AUDIT_MODEL,
    max_tokens: AUDIT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(site, pageSpeed) }],
  });

  let raw = "";
  for (const block of response.content) {
    if (block.type === "text") raw += block.text;
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    parsed = {};
  }

  const overall = clampScore(parsed.overall_score, 50);
  const seo = clampScore(parsed.seo_score, pageSpeed.seo ?? 50);
  const speed = clampScore(parsed.speed_score, pageSpeed.performance ?? 50);
  const mobile = clampScore(parsed.mobile_score, pageSpeed.mobile_performance ?? 50);
  const conversion = clampScore(parsed.conversion_score, 50);

  const explicitGrade = parsed.opportunity_grade;
  const grade: OpportunityGrade =
    explicitGrade === "A+" || explicitGrade === "A" || explicitGrade === "B" || explicitGrade === "C"
      ? explicitGrade
      : gradeFromScore(overall);

  const estLost =
    typeof parsed.estimated_monthly_leads_lost === "number" &&
    Number.isFinite(parsed.estimated_monthly_leads_lost)
      ? Math.max(0, Math.round(parsed.estimated_monthly_leads_lost))
      : 0;

  return {
    overall_score: overall,
    seo_score: seo,
    speed_score: speed,
    mobile_score: mobile,
    conversion_score: conversion,
    opportunity_grade: grade,
    missing_pages: asStringArray(parsed.missing_pages),
    missing_schema: asStringArray(parsed.missing_schema),
    gbp_issues: asStringArray(parsed.gbp_issues),
    competitor_gaps: asStringArray(parsed.competitor_gaps),
    top_3_recommendations: asStringArray(parsed.top_3_recommendations).slice(0, 3),
    estimated_monthly_leads_lost: estLost,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}
