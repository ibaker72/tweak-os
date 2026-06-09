import type { Lead, OutreachData, EnrichmentResult } from "./types";
import { generateCompletion } from "@/lib/ai/anthropic";
import { guessIndustryFromName } from "./industry-guess";

const NJ_SOURCE_LABEL = "NJ Business Records";

function isLaunchKitCandidate(lead: Lead): boolean {
  if (lead.source === NJ_SOURCE_LABEL && !lead.website) return true;
  if (lead.online_presence === "none_found") return true;
  return false;
}

interface OutreachContext {
  business_name: string;
  website: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  tech_stack: string[];
  has_ssl: boolean | null;
  is_mobile_responsive: boolean | null;
  has_blog: boolean | null;
  has_ecommerce: boolean | null;
  page_load_time_ms: number | null;
  google_rating: number | null;
  google_review_count: number | null;
  score: number;
  score_breakdown: Record<string, number>;
  emails: string[];
  social_count: number;
}

function buildContext(lead: Lead, enrichment?: EnrichmentResult): OutreachContext {
  return {
    business_name: lead.business_name,
    website: lead.website,
    industry: lead.niche || lead.industry || null,
    city: lead.city,
    state: lead.state,
    tech_stack: lead.tech_stack || [],
    has_ssl: lead.has_ssl,
    is_mobile_responsive: lead.is_mobile_responsive,
    has_blog: lead.has_blog,
    has_ecommerce: lead.has_ecommerce,
    page_load_time_ms: lead.page_load_time_ms,
    google_rating: lead.google_rating,
    google_review_count: lead.google_review_count,
    score: lead.score,
    score_breakdown: lead.score_breakdown || {},
    emails: enrichment?.emails || [lead.email_1, lead.email_2, lead.email].filter(Boolean) as string[],
    social_count: [lead.social_links?.facebook, lead.social_links?.instagram, lead.social_links?.linkedin, lead.social_links?.twitter].filter(Boolean).length,
  };
}

export function determinePricingTier(ctx: OutreachContext): string {
  if (ctx.has_ecommerce || ctx.tech_stack.length > 3) {
    return "Custom Engineering ($8K-$30K+)";
  }
  if (ctx.tech_stack.some((t) => ["Wix", "Squarespace", "WordPress", "GoDaddy"].includes(t))) {
    return "Rapid Build ($2,500-$8K)";
  }
  if (ctx.has_blog && ctx.google_rating && ctx.google_rating >= 4.0) {
    return "Growth Retainer ($2K-$5K/mo)";
  }
  return "Rapid Build ($2,500-$8K)";
}

export async function generateOutreach(
  lead: Lead,
  enrichment?: EnrichmentResult
): Promise<OutreachData> {
  if (isLaunchKitCandidate(lead)) {
    return generateLaunchKitOutreach(lead);
  }

  const ctx = buildContext(lead, enrichment);
  const pricingTier = determinePricingTier(ctx);

  const systemPrompt = `You are an outreach specialist for Tweak & Build, a premium product engineering studio. We build websites, web apps, and automation systems for non-technical founders and early-stage startups. Price range: $2,500-$30,000+.

Our services:
- Rapid Build ($2,500-$8K): Quick website builds and rebuilds
- Custom Engineering ($8K-$30K+): Complex web apps and custom solutions
- Growth Retainer ($2K-$5K/mo): Ongoing development and optimization

Case studies to reference:
- Create3DParts: E-commerce platform (for e-commerce leads)
- LeadsAndSaaS: SaaS platform (for SaaS leads)

Important:
- Be specific about their business, not generic
- Reference actual findings from their website
- Keep everything concise and actionable
- Sound human, not like a template
- Never be pushy or salesy`;

  const userPrompt = `Generate personalized outreach for this lead:

Business: ${ctx.business_name}
Website: ${ctx.website || "None"}
Industry: ${ctx.industry || "Unknown"}
Location: ${[ctx.city, ctx.state].filter(Boolean).join(", ") || "Unknown"}
Tech Stack: ${ctx.tech_stack.join(", ") || "Unknown"}
SSL: ${ctx.has_ssl ? "Yes" : "No"}
Mobile Responsive: ${ctx.is_mobile_responsive ? "Yes" : "No"}
Has Blog: ${ctx.has_blog ? "Yes" : "No"}
Has E-commerce: ${ctx.has_ecommerce ? "Yes" : "No"}
Page Load Time: ${ctx.page_load_time_ms ? `${(ctx.page_load_time_ms / 1000).toFixed(1)}s` : "Unknown"}
Google Rating: ${ctx.google_rating ? `${ctx.google_rating}/5 (${ctx.google_review_count} reviews)` : "N/A"}
Score: ${ctx.score}/100
Recommended Tier: ${pricingTier}

Generate the following in JSON format:
{
  "pain_points": ["point1", "point2", "point3"],
  "offer_angle": "Which Tweak & Build service fits and why, with pricing tier",
  "cold_email": "Ready-to-send cold email (under 5 sentences). Structure: specific observation → one problem → one proof point → low-commitment CTA",
  "linkedin_dm": "LinkedIn DM version (2-3 sentences max, casual tone)",
  "follow_up_email": "Follow-up email for 5 days later (different angle, shorter than first email)"
}

Respond with ONLY valid JSON, no markdown.`;

  const content = await generateCompletion({
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 1500,
  });

  try {
    const parsed = JSON.parse(content);
    return {
      pain_points: parsed.pain_points ?? [],
      offer_angle: parsed.offer_angle ?? "",
      cold_email: parsed.cold_email ?? "",
      linkedin_dm: parsed.linkedin_dm ?? "",
      follow_up_email: parsed.follow_up_email ?? "",
      pricing_tier: pricingTier,
    };
  } catch {
    return {
      pain_points: [],
      offer_angle: pricingTier,
      cold_email: content,
      linkedin_dm: "",
      follow_up_email: "",
      pricing_tier: pricingTier,
    };
  }
}

const LAUNCH_KIT_TIER = "New Business Launch Kit";

async function generateLaunchKitOutreach(lead: Lead): Promise<OutreachData> {
  const industry = lead.niche || guessIndustryFromName(lead.business_name) || "local services";
  const location = [lead.city, lead.state].filter(Boolean).join(", ") || "New Jersey";
  const filingDate = lead.source_filing_date ? `Filed ${lead.source_filing_date}` : "Recently filed";

  const systemPrompt = `You are an outreach specialist for Tweak & Build, a product engineering studio that helps newly formed businesses get online fast. For this lead, the company is brand new — there is no public website or Google Business Profile yet. We pitch the New Business Launch Kit:

- Custom website
- Google Business Profile setup and optimization
- Lead capture form
- Click-to-call
- Basic local SEO
- Booking/contact flow
- Optional CRM and follow-up automation

Required positioning (use as the foundation for the cold_email):
"I came across your new business while researching local companies in New Jersey. I noticed there may not be a public website or Google presence set up yet. Tweak&Build helps newly formed businesses launch their website, Google Business Profile, lead forms, and follow-up system so customers can find and contact them."

Important:
- Tone is warm, not pushy. The business owner is starting something new.
- Be specific to the business name and industry. Do NOT mention tech stacks, page load times, or website audits — they don't have a site to audit.
- SMS must be under 160 characters.
- Call opener is one or two sentences a human would say on a cold call.`;

  const userPrompt = `Generate launch-kit outreach for this lead:

Business: ${lead.business_name}
Source: ${lead.source ?? "NJ Business Records"} (${filingDate})
Industry guess: ${industry}
Location: ${location}
Registered agent: ${lead.registered_agent ?? "unknown"}
Address: ${lead.address ?? "unknown"}

Respond with ONLY valid JSON, no markdown:
{
  "pain_points": ["3 reasons a newly formed business in this industry loses customers without an online presence"],
  "offer_angle": "Why the New Business Launch Kit fits this specific business",
  "cold_email": "Cold email under 6 sentences using the required positioning",
  "sms": "Friendly SMS under 160 characters",
  "call_opener": "Cold-call opener, 1-2 sentences",
  "linkedin_dm": "LinkedIn DM, 2-3 sentences",
  "follow_up_email": "Follow-up email 5 days later, shorter and a different angle"
}`;

  const content = await generateCompletion({
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 1500,
  });

  try {
    const parsed = JSON.parse(content);
    return {
      pain_points: parsed.pain_points ?? [],
      offer_angle: parsed.offer_angle ?? "",
      cold_email: parsed.cold_email ?? "",
      linkedin_dm: parsed.linkedin_dm ?? "",
      follow_up_email: parsed.follow_up_email ?? "",
      sms: parsed.sms ?? "",
      call_opener: parsed.call_opener ?? "",
      pricing_tier: LAUNCH_KIT_TIER,
    };
  } catch {
    return {
      pain_points: [],
      offer_angle: LAUNCH_KIT_TIER,
      cold_email: content,
      linkedin_dm: "",
      follow_up_email: "",
      sms: "",
      call_opener: "",
      pricing_tier: LAUNCH_KIT_TIER,
    };
  }
}
