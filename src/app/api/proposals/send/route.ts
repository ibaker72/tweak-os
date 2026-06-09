import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  renderProposalEmailBody,
  renderProposalDocumentHtml,
} from "@/lib/proposals/render";
import { slugifyClient } from "@/lib/proposals/sections";
import type { ProposalSections } from "@/lib/proposals/types";

export const maxDuration = 30;

const serviceSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
  billing: z.enum(["one-time", "monthly"]),
});

const sectionsSchema = z.object({
  executive_summary: z.string().default(""),
  what_we_found: z.string().default(""),
  our_recommendation: z.string().default(""),
  investment_summary: z.string().default(""),
  what_happens_next: z.string().default(""),
  about: z.string().default(""),
  custom_notes: z.string().default(""),
});

const inputSchema = z.object({
  proposalId: z.string().uuid().optional(),
  clientName: z.string().min(1, "Client name is required"),
  websiteUrl: z.string().optional().default(""),
  recipientName: z.string().optional().default(""),
  recipientEmail: z.string().email("Valid recipient email is required"),
  subject: z.string().min(1, "Subject is required"),
  message: z.string().min(1, "Email message is required"),
  proposalHtml: z.string().optional().default(""),
  proposalSections: sectionsSchema,
  attachPdf: z.boolean().default(false),
  pdfBase64: z.string().optional(),
  selectedServices: z.array(serviceSchema).default([]),
  totals: z
    .object({
      total_one_time: z.number().nonnegative().default(0),
      total_monthly: z.number().nonnegative().default(0),
    })
    .default({ total_one_time: 0, total_monthly: 0 }),
  sendToOwnerOnly: z.boolean().optional().default(false),
});

interface ResendAttachment {
  filename: string;
  content: string; // base64
}

interface ResendErrorBody {
  message?: string;
  name?: string;
  statusCode?: number;
}

async function sendViaResend(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: ResendAttachment[];
  replyTo?: string;
}) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      reply_to: opts.replyTo,
      attachments: opts.attachments,
    }),
  });
  if (!res.ok) {
    let body: ResendErrorBody = {};
    try {
      body = (await res.json()) as ResendErrorBody;
    } catch {
      // body wasn't JSON — fall through
    }
    throw new Error(
      `Resend ${res.status}: ${body.message || body.name || res.statusText}`
    );
  }
  return res.json();
}

export async function POST(request: NextRequest) {
  let input: z.infer<typeof inputSchema>;
  try {
    const body = await request.json();
    input = inputSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      return NextResponse.json(
        { error: first?.message || "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Extra runtime guard: don't try to send a blank proposal.
  const sectionsFilled = Object.values(input.proposalSections).some(
    (s) => typeof s === "string" && s.trim().length > 0
  );
  if (!sectionsFilled) {
    return NextResponse.json(
      { error: "Proposal is empty — fill in at least one section before sending." },
      { status: 400 }
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEnv =
    process.env.RESEND_FROM_EMAIL ||
    process.env.OUTREACH_FROM_EMAIL ||
    process.env.MAIL_FROM ||
    "Tweak & Build <hello@tweakandbuild.com>";
  const ownerEmail =
    process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL;

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Email delivery is not configured. Set RESEND_API_KEY (and optionally RESEND_FROM_EMAIL, OWNER_EMAIL) in your environment.",
      },
      { status: 503 }
    );
  }

  const recipient = input.sendToOwnerOnly
    ? ownerEmail || input.recipientEmail
    : input.recipientEmail;
  if (input.sendToOwnerOnly && !ownerEmail) {
    return NextResponse.json(
      {
        error:
          "OWNER_EMAIL is not set — cannot send a test to yourself. Add OWNER_EMAIL to your environment or send the proposal to a real recipient.",
      },
      { status: 503 }
    );
  }

  const sections = input.proposalSections as ProposalSections;

  const emailHtml = renderProposalEmailBody({
    sections,
    clientName: input.clientName,
    recipientName: input.recipientName || "there",
    message: input.message,
  });

  let attachments: ResendAttachment[] | undefined;
  if (input.attachPdf && input.pdfBase64) {
    attachments = [
      {
        filename: `tweak-and-build-proposal-${slugifyClient(input.clientName)}.pdf`,
        content: input.pdfBase64,
      },
    ];
  }

  try {
    await sendViaResend({
      apiKey,
      from: fromEnv,
      to: recipient,
      subject: input.sendToOwnerOnly ? `[Test] ${input.subject}` : input.subject,
      html: emailHtml,
      replyTo: ownerEmail,
      attachments,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Email send failed";
    console.error("Proposal send error:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // Persist as "sent" if a real recipient + we have a proposal record.
  let proposalId = input.proposalId;
  if (!input.sendToOwnerOnly) {
    try {
      const supabase = await createClient();
      const fullHtml = renderProposalDocumentHtml({
        sections,
        clientName: input.clientName,
        websiteUrl: input.websiteUrl || undefined,
      });
      if (proposalId) {
        await supabase
          .from("proposals")
          .update({
            recipient_name: input.recipientName || null,
            recipient_email: input.recipientEmail,
            proposal_sections: sections,
            proposal_html: input.proposalHtml || fullHtml,
            client_name: input.clientName,
            website_url: input.websiteUrl || null,
            services_json: input.selectedServices,
            total_one_time: input.totals.total_one_time,
            total_monthly: input.totals.total_monthly,
            status: "sent",
            sent_at: new Date().toISOString(),
            last_edited_at: new Date().toISOString(),
          })
          .eq("id", proposalId);
      } else {
        const { data, error } = await supabase
          .from("proposals")
          .insert({
            client_name: input.clientName,
            website_url: input.websiteUrl || null,
            recipient_name: input.recipientName || null,
            recipient_email: input.recipientEmail,
            services_json: input.selectedServices,
            proposal_sections: sections,
            proposal_html: input.proposalHtml || fullHtml,
            total_one_time: input.totals.total_one_time,
            total_monthly: input.totals.total_monthly,
            status: "sent",
            sent_at: new Date().toISOString(),
            last_edited_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (!error && data?.id) proposalId = data.id as string;
      }
    } catch (err) {
      console.error("Proposal persist-after-send error:", err);
    }
  }

  return NextResponse.json({
    success: true,
    recipient,
    proposalId: proposalId ?? null,
    test: input.sendToOwnerOnly,
  });
}
