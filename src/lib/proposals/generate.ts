import Anthropic from "@anthropic-ai/sdk";
import {
  buildInvestmentSummary,
  calculateTotals,
  formatMoney,
} from "./services";
import type { ProposalInput } from "./types";

/** Re-exported so callers keep one import for prompt + totals. */
export { calculateTotals } from "./services";

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

export const PROPOSAL_SYSTEM_PROMPT = `You are a senior strategist at Tweak & Build, a founder-led web and marketing agency. Write professional, confident, specific proposals.

HOW TWEAK & BUILD SELLS:
- Every engagement is custom-scoped around the client's goals after a discovery conversation. We do not sell fixed, off-the-shelf packages or tiers.
- The services listed in the request are the scope agreed for THIS client. Use their exact names. Never rename them, never merge them into a "package", and never present them as a product the client could find on a public price list.
- Never mention, compare to, or imply other tiers, bundles, upgrades, or "starting at" pricing.

PRICING RULES (absolute):
- Every amount you write must come from the structured pricing in the request, character for character. Never invent, estimate, round, discount, annualize, or add a price.
- One-time and monthly amounts stay separate everywhere. Never combine them into a single figure.
- If a service has no amount listed, say that piece is priced after discovery — do not guess a number.

CRITICAL CREDIBILITY RULES:
- Never claim exact numbers of "leads lost per month" unless backed by search-volume data the user explicitly provided.
- Use soft, defensible phrasing like "may be missing a meaningful number of local leads" or "strong opportunity to capture more local search demand."
- Never guarantee rankings, lead counts, or revenue outcomes.
- Speak directly to the business owner; use their business name and website throughout.
- No fluff. No hype. No emojis.`;

function scopeBlock(input: ProposalInput): string {
  if (input.selected_services.length === 0) return "(no scope selected yet)";
  return input.selected_services
    .map((svc, i) => {
      const lines = [`${i + 1}. ${svc.name}`];
      lines.push(
        `   - One-time: ${
          (svc.one_time_price ?? 0) > 0
            ? formatMoney(svc.one_time_price as number)
            : "none"
        }`
      );
      lines.push(
        `   - Monthly: ${
          (svc.monthly_price ?? 0) > 0
            ? `${formatMoney(svc.monthly_price as number)}/month`
            : "none"
        }`
      );
      const note = svc.description?.trim();
      if (note) lines.push(`   - Scope note: ${note}`);
      return lines.join("\n");
    })
    .join("\n");
}

export function buildProposalUserPrompt(input: ProposalInput): string {
  const totals = calculateTotals(input.selected_services);
  // The investment block is computed from the selected line items, never
  // written by the model — the client reads exactly what the agent priced.
  const investment = buildInvestmentSummary(input.selected_services, totals);

  return `CLIENT INFO:
- Client name: ${input.client_name || "(unspecified)"}
- Business type: ${input.business_type || "(unspecified)"}
- Website: ${input.website_url || "(unspecified)"}

SCOPE FOR THIS CLIENT (exact names and amounts — do not change any of them):
${scopeBlock(input)}

TOTALS (already calculated — do not recalculate):
- Total one-time: ${formatMoney(totals.total_one_time)}
- Monthly ongoing: ${formatMoney(totals.total_monthly)}/month

NOTES FROM SALES AGENT:
${input.notes || "(none)"}

Generate a professional proposal with exactly these 7 sections.
Use markdown formatting with ## for section headers.

## Executive Summary
2-3 sentences. Personalized to their business and situation. Frame the work as a scope built for them, not a package they picked off a shelf. DO NOT invent exact lead numbers or traffic figures.

## What We Found
3-5 bullet points on the problems this business type commonly has, each tied to an action, informed by the sales agent's notes above.
Use conservative language — "may be", "appears to be", "opportunity to" — never absolute claims.

## Our Recommendation
One short paragraph on how this scope was put together for their goals, then a bulleted list of the selected services with a one-sentence rationale each. Use each service name exactly as written above, and use the scope notes where they are provided.

## Investment Summary
Reproduce the following block EXACTLY as written. Do not reformat it, reorder it, add or remove rows, or change a single amount:

${investment}

## What Happens Next
3 numbered steps: Discovery Call → Build → Launch
Keep brief.

## About Tweak & Build
Exactly 2 sentences:
'Tweak & Build is a founder-led product engineering studio based in New Jersey. We built speedwaymotorsllc.com and ppmechanicalllc.com — custom systems that generate real leads for real businesses.'

## Custom Notes
Leave this section empty or include 1-2 lines pulled from the sales agent's notes if relevant. If there are no relevant notes, just write a single line: "—".`;
}

export async function streamProposal(
  input: ProposalInput
): Promise<ReadableStream<Uint8Array>> {
  const client = getClient();
  const userPrompt = buildProposalUserPrompt(input);

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
