import type { Lead, OutreachData, EnrichmentResult } from "./types";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  return key;
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

function determinePricingTier(ctx: OutreachContext): string {
  // Custom Engineering for complex needs
  if (ctx.has_ecommerce || ctx.tech_stack.length > 3) {
    return "Custom Engineering ($8K-$30K+)";
  }
  // Rapid Build for simpler rebuilds
  if (ctx.tech_stack.some((t) => ["Wix", "Squarespace", "WordPress", "GoDaddy"].includes(t))) {
    return "Rapid Build ($2,500-$8K)";
  }
  // Growth Retainer for ongoing needs
  if (ctx.has_blog && ctx.google_rating && ctx.google_rating >= 4.0) {
    return "Growth Retainer ($2K-$5K/mo)";
  }
  return "Rapid Build ($2,500-$8K)";
}

export async function generateOutreach(
  lead: Lead,
  enrichment?: EnrichmentResult
): Promise<OutreachData> {
  const apiKey = getOpenAIKey();
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

  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";

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
    // If JSON parsing fails, try to extract meaningful content
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
