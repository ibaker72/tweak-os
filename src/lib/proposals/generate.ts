import Anthropic from "@anthropic-ai/sdk";
import type { ProposalInput, ProposalService } from "./types";
import type { AuditJson } from "@/lib/audits/types";

const PROPOSAL_MODEL = "claude-sonnet-4-20250514";
const PROPOSAL_MAX_TOKENS = 2500;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

export const PROPOSAL_SYSTEM_PROMPT = `You are a senior strategist at Tweak & Build, a founder-led web and marketing agency. Write professional, confident, specific proposals. No fluff. Speak directly to the business owner. Use their business name and website throughout.`;

export function calculateTotals(services: ProposalService[]): {
  total_one_time: number;
  total_monthly: number;
} {
  let total_one_time = 0;
  let total_monthly = 0;
  for (const svc of services) {
    if (svc.billing === "one-time") total_one_time += svc.price;
    else if (svc.billing === "monthly") total_monthly += svc.price;
  }
  return { total_one_time, total_monthly };
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function buildProposalUserPrompt(
  input: ProposalInput,
  audit: AuditJson | null
): string {
  const { total_one_time, total_monthly } = calculateTotals(input.selected_services);
  const services = input.selected_services
    .map(
      (s) =>
        `- ${s.name}: ${formatMoney(s.price)} (${
          s.billing === "monthly" ? "monthly" : "one-time"
        })`
    )
    .join("\n");

  const auditSection = audit
    ? [
        "",
        "AUDIT FINDINGS:",
        `- Overall score: ${audit.overall_score}/100 (Grade ${audit.opportunity_grade})`,
        `- SEO: ${audit.seo_score}, Speed: ${audit.speed_score}, Mobile: ${audit.mobile_score}, Conversion: ${audit.conversion_score}`,
        `- Missing pages: ${audit.missing_pages.join(", ") || "(none)"}`,
        `- Missing schema: ${audit.missing_schema.join(", ") || "(none)"}`,
        `- GBP issues: ${audit.gbp_issues.join(", ") || "(none)"}`,
        `- Competitor gaps: ${audit.competitor_gaps.join(", ") || "(none)"}`,
        `- Top recommendations: ${audit.top_3_recommendations.join("; ") || "(none)"}`,
        `- Estimated leads lost/month: ${audit.estimated_monthly_leads_lost}`,
        `- Summary: ${audit.summary}`,
      ].join("\n")
    : "";

  return `CLIENT INFO:
- Client name: ${input.client_name || "(unspecified)"}
- Business type: ${input.business_type || "(unspecified)"}
- Website: ${input.website_url || "(unspecified)"}

SELECTED SERVICES:
${services || "(none selected)"}

TOTALS:
- One-time: ${formatMoney(total_one_time)}
- Monthly: ${formatMoney(total_monthly)}

NOTES FROM SALES AGENT:
${input.notes || "(none)"}
${auditSection}

Generate a professional proposal with exactly these 6 sections.
Use markdown formatting with ## for section headers.

## Executive Summary
2-3 sentences. Personalized to their business and situation.

## What We Found
If audit data provided: bullet points of top issues found.
If no audit: 3 general bullets about common problems for their business type.

## Our Recommendation
Which services you recommend and specifically why, tied to their situation.

## Investment Summary
Markdown table with columns: Service | Price | Billing
End with: Total One-Time: ${formatMoney(total_one_time)}
          Total Monthly: ${formatMoney(total_monthly)}/mo

## What Happens Next
3 numbered steps: Discovery Call → Build → Launch
Keep brief.

## About Tweak & Build
Exactly 2 sentences:
'Tweak & Build is a founder-led product engineering studio based in New Jersey. We built speedwaymotorsllc.com and ppmechanicalllc.com — custom systems that generate real leads for real businesses.'`;
}

export async function streamProposal(
  input: ProposalInput,
  audit: AuditJson | null
): Promise<ReadableStream<Uint8Array>> {
  const client = getClient();
  const userPrompt = buildProposalUserPrompt(input, audit);

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = await client.messages.create({
          model: PROPOSAL_MODEL,
          max_tokens: PROPOSAL_MAX_TOKENS,
          system: PROPOSAL_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
          stream: true,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Streaming failed";
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
  });
}
