import type { Lead } from "@/lib/leads/types";
import { generateCompletion, stripJsonFences } from "@/lib/ai/anthropic";
import { guessIndustryFromName } from "@/lib/leads/industry-guess";

export interface OpenClawOutreachOptions {
  tone?: string;
  offer?: string;
  channel?: string;
}

export interface OpenClawOutreachResult {
  pain_points: string[];
  offer_angle: string;
  cold_call_opener: string;
  sms: string;
  email_subject: string;
  email_body: string;
  follow_up_email: string;
  next_best_action: string;
}

const EMPTY: OpenClawOutreachResult = {
  pain_points: [],
  offer_angle: "",
  cold_call_opener: "",
  sms: "",
  email_subject: "",
  email_body: "",
  follow_up_email: "",
  next_best_action: "",
};

function buildSystemPrompt(opts: OpenClawOutreachOptions): string {
  const tone = opts.tone || "professional";
  const offer = opts.offer || "New Business Launch Kit";
  return `You write outreach for Tweak & Build, a founder-led product engineering studio in New Jersey. We help small businesses launch and grow with custom websites, Google Business Profile setup, lead forms, follow-up automation, and ongoing growth retainers.

Tone: ${tone}.
Default offer: ${offer}.

Mandatory guardrails:
- Use specific facts about THIS business — name, industry, location, what we found in enrichment.
- Never promise rankings, lead counts, or revenue numbers. Use language like "may help" or "could improve" — not "will deliver".
- Never invent customers, awards, or testimonials.
- Keep SMS under 160 characters.
- Keep the cold-call opener to 1-2 sentences a human would say live.
- Email body must be ≤ 6 sentences. Lead with one specific observation, name one problem, and end with a low-commitment ask.
- Output strict JSON only. No markdown, no code fences, no commentary outside the JSON.`;
}

function buildUserPrompt(
  lead: Lead,
  opts: OpenClawOutreachOptions
): string {
  const industry = lead.niche || guessIndustryFromName(lead.business_name) || "local services";
  const location = [lead.city, lead.state].filter(Boolean).join(", ") || "New Jersey";
  const techStack = (lead.tech_stack || []).join(", ") || "unknown";
  const offer = opts.offer || "New Business Launch Kit";
  const channel = opts.channel || "email_sms_call";
  return `Lead context:
- Business: ${lead.business_name}
- Industry: ${industry}
- Location: ${location}
- Website: ${lead.website || "no public website found"}
- Phone: ${lead.phone || "unknown"}
- Email: ${lead.email || "unknown"}
- Tech stack: ${techStack}
- SSL: ${lead.has_ssl === null ? "unknown" : lead.has_ssl ? "yes" : "no"}
- Mobile responsive: ${lead.is_mobile_responsive === null ? "unknown" : lead.is_mobile_responsive ? "yes" : "no"}
- Has blog: ${lead.has_blog === null ? "unknown" : lead.has_blog ? "yes" : "no"}
- Has e-commerce: ${lead.has_ecommerce === null ? "unknown" : lead.has_ecommerce ? "yes" : "no"}
- Page load time: ${lead.page_load_time_ms ? `${(lead.page_load_time_ms / 1000).toFixed(1)}s` : "unknown"}
- Google rating: ${lead.google_rating ? `${lead.google_rating}/5 (${lead.google_review_count ?? 0} reviews)` : "no profile found"}
- Score: ${lead.score}/100
- Source: ${lead.source || "unknown"}
- Enrichment summary: ${lead.enrichment_summary || "n/a"}

Recommended offer: ${offer}
Channels to cover: ${channel}

Return a single JSON object exactly matching this schema (no extra keys, no nulls):
{
  "pain_points": [string, string, string],
  "offer_angle": string,
  "cold_call_opener": string,
  "sms": string,
  "email_subject": string,
  "email_body": string,
  "follow_up_email": string,
  "next_best_action": string
}`;
}

function safeString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function safeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeOutreach(raw: string): OpenClawOutreachResult {
  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { ...EMPTY };
  }
  if (!parsed || typeof parsed !== "object") return { ...EMPTY };
  const obj = parsed as Record<string, unknown>;
  return {
    pain_points: safeStringArray(obj.pain_points).slice(0, 6),
    offer_angle: safeString(obj.offer_angle),
    cold_call_opener: safeString(obj.cold_call_opener),
    sms: safeString(obj.sms).slice(0, 320),
    email_subject: safeString(obj.email_subject),
    email_body: safeString(obj.email_body),
    follow_up_email: safeString(obj.follow_up_email),
    next_best_action: safeString(obj.next_best_action),
  };
}

export async function generateOpenClawOutreach(
  lead: Lead,
  opts: OpenClawOutreachOptions = {}
): Promise<OpenClawOutreachResult> {
  const raw = await generateCompletion({
    system: buildSystemPrompt(opts),
    user: buildUserPrompt(lead, opts),
    maxTokens: 1500,
  });
  return normalizeOutreach(raw);
}
