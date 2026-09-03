import { NextRequest } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import {
  PROPOSAL_SYSTEM_PROMPT,
  buildProposalUserPrompt,
} from "@/lib/proposals/generate";
import {
  parseSectionsFromMarkdown,
  sectionsToMarkdown,
  sectionsToPlainText,
} from "@/lib/proposals/sections";
import { proposalServiceSchema } from "@/lib/proposals/schema";
import {
  buildInvestmentSummary,
  calculateTotals,
  normalizeServices,
} from "@/lib/proposals/services";
import { requireUser } from "@/lib/auth/guard";
import { canAttachLead } from "@/lib/proposals/lead-link";

const PROPOSAL_MODEL = "claude-sonnet-4-20250514";
const PROPOSAL_MAX_TOKENS = 2500;

const inputSchema = z.object({
  client_name: z.string().default(""),
  business_type: z.string().default(""),
  website_url: z.string().default(""),
  selected_services: z.array(proposalServiceSchema).default([]),
  notes: z.string().default(""),
  lead_id: z.string().uuid().optional(),
});

export const maxDuration = 60;

let _client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

// POST /api/proposals/generate — stream proposal back; persist on completion
export async function POST(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  let parsed;
  try {
    const body = await request.json();
    parsed = inputSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    return Response.json({ error: "Invalid input" }, { status: 400 });
  }

  const input = parsed;
  // Prices are structured data, not model output: normalize the incoming
  // lines once and drive both the totals and the investment section from
  // them so nothing the model writes can change an amount.
  const services = normalizeServices(input.selected_services);
  const { total_one_time, total_monthly } = calculateTotals(services);
  const investmentSummary = buildInvestmentSummary(services, {
    total_one_time,
    total_monthly,
  });

  const supabase = guard.supabase;

  // Same rule as the save route: a proposal may only reference a lead this
  // caller is allowed to see. Checked before the model is called so an
  // unauthorized lead_id costs nothing.
  if (input.lead_id && !(await canAttachLead(supabase, input.lead_id))) {
    return Response.json(
      { error: "Lead not found or not available to this account" },
      { status: 403 }
    );
  }

  const userPrompt = buildProposalUserPrompt({
    client_name: input.client_name,
    business_type: input.business_type,
    website_url: input.website_url,
    selected_services: services,
    notes: input.notes,
    lead_id: input.lead_id,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullText = "";
      try {
        const client = getAnthropic();
        const llmStream = await client.messages.create({
          model: PROPOSAL_MODEL,
          max_tokens: PROPOSAL_MAX_TOKENS,
          system: PROPOSAL_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
          stream: true,
        });

        for await (const event of llmStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const chunk = event.delta.text;
            fullText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Streaming failed";
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
      } finally {
        controller.close();

        // Persist after streaming completes (best-effort).
        try {
          const sections = parseSectionsFromMarkdown(fullText);
          // The investment section is deterministic — whatever the model
          // produced is replaced with the numbers the agent entered.
          sections.investment_summary = investmentSummary;
          const plain = sectionsToPlainText(sections);
          // Store the reconciled markdown, not the raw stream, so the
          // saved document and its sections quote the same numbers.
          const markdown = sectionsToMarkdown(sections) || fullText;
          await supabase.from("proposals").insert({
            lead_id: input.lead_id ?? null,
            created_by: guard.agent.id,
            client_name: input.client_name || null,
            business_type: input.business_type || null,
            website_url: input.website_url || null,
            services_json: services,
            proposal_html: markdown,
            proposal_sections: sections,
            proposal_text: plain,
            total_one_time,
            total_monthly,
            status: "draft",
            last_edited_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error("Proposal persist error:", err);
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
