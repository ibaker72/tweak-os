import { NextRequest } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import {
  PROPOSAL_SYSTEM_PROMPT,
  buildProposalUserPrompt,
  calculateTotals,
} from "@/lib/proposals/generate";
import {
  parseSectionsFromMarkdown,
  sectionsToPlainText,
} from "@/lib/proposals/sections";
import type { AuditJson } from "@/lib/audits/types";
import type { ProposalService } from "@/lib/proposals/types";

const PROPOSAL_MODEL = "claude-sonnet-4-20250514";
const PROPOSAL_MAX_TOKENS = 2500;

const serviceSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
  billing: z.enum(["one-time", "monthly"]),
});

const inputSchema = z.object({
  client_name: z.string().default(""),
  business_type: z.string().default(""),
  website_url: z.string().default(""),
  selected_services: z.array(serviceSchema).default([]),
  notes: z.string().default(""),
  audit_id: z.string().uuid().optional(),
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
  const { total_one_time, total_monthly } = calculateTotals(
    input.selected_services as ProposalService[]
  );

  const supabase = await createClient();

  // Look up audit if provided so we can pass findings into the prompt.
  let audit: AuditJson | null = null;
  if (input.audit_id) {
    try {
      const { data } = await supabase
        .from("lead_audits")
        .select("audit_json")
        .eq("id", input.audit_id)
        .maybeSingle();
      if (data?.audit_json) audit = data.audit_json as AuditJson;
    } catch {
      audit = null;
    }
  }

  const userPrompt = buildProposalUserPrompt(
    {
      client_name: input.client_name,
      business_type: input.business_type,
      website_url: input.website_url,
      selected_services: input.selected_services as ProposalService[],
      notes: input.notes,
      audit_id: input.audit_id,
      lead_id: input.lead_id,
    },
    audit
  );

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
          const plain = sectionsToPlainText(sections);
          await supabase.from("proposals").insert({
            lead_id: input.lead_id ?? null,
            audit_id: input.audit_id ?? null,
            client_name: input.client_name || null,
            business_type: input.business_type || null,
            website_url: input.website_url || null,
            services_json: input.selected_services,
            proposal_html: fullText,
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
