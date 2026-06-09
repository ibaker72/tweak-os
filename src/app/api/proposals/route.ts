import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sectionsToMarkdown, sectionsToPlainText } from "@/lib/proposals/sections";
import type { ProposalSections } from "@/lib/proposals/types";

// GET /api/proposals — list recent proposals
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("proposals")
      .select(
        "id, lead_id, audit_id, client_name, business_type, website_url, recipient_name, recipient_email, services_json, proposal_html, proposal_sections, proposal_text, pdf_url, total_one_time, total_monthly, status, sent_at, last_edited_at, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return NextResponse.json({ proposals: data ?? [] });
  } catch (err) {
    console.error("Proposals list error:", err);
    return NextResponse.json(
      { error: "Failed to load proposals" },
      { status: 500 }
    );
  }
}

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

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  client_name: z.string().default(""),
  business_type: z.string().default(""),
  website_url: z.string().default(""),
  recipient_name: z.string().default(""),
  recipient_email: z.string().email().or(z.literal("")).default(""),
  selected_services: z.array(serviceSchema).default([]),
  proposal_sections: sectionsSchema.optional(),
  proposal_html: z.string().default(""),
  lead_id: z.string().uuid().optional(),
  audit_id: z.string().uuid().optional(),
});

// POST /api/proposals — save (insert) or upsert a proposal explicitly
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = saveSchema.parse(body);
    const total_one_time = input.selected_services
      .filter((s) => s.billing === "one-time")
      .reduce((a, s) => a + s.price, 0);
    const total_monthly = input.selected_services
      .filter((s) => s.billing === "monthly")
      .reduce((a, s) => a + s.price, 0);

    const sections = input.proposal_sections as ProposalSections | undefined;
    const md = sections
      ? sectionsToMarkdown(sections)
      : input.proposal_html || "";
    const txt = sections ? sectionsToPlainText(sections) : "";

    const row = {
      lead_id: input.lead_id ?? null,
      audit_id: input.audit_id ?? null,
      client_name: input.client_name || null,
      business_type: input.business_type || null,
      website_url: input.website_url || null,
      recipient_name: input.recipient_name || null,
      recipient_email: input.recipient_email || null,
      services_json: input.selected_services,
      proposal_html: md,
      proposal_sections: sections ?? {},
      proposal_text: txt || null,
      total_one_time,
      total_monthly,
      status: "saved" as const,
      last_edited_at: new Date().toISOString(),
    };

    const supabase = await createClient();
    if (input.id) {
      const { data, error } = await supabase
        .from("proposals")
        .update(row)
        .eq("id", input.id)
        .select("id, created_at")
        .single();
      if (error) throw error;
      return NextResponse.json({ success: true, proposal: data });
    }
    const { data, error } = await supabase
      .from("proposals")
      .insert(row)
      .select("id, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, proposal: data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Proposal save error:", err);
    return NextResponse.json(
      { error: "Save failed" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["draft", "saved", "sent", "won", "lost"]).optional(),
});

// PATCH /api/proposals — update status of a proposal
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = patchSchema.parse(body);
    const supabase = await createClient();
    const { error } = await supabase
      .from("proposals")
      .update(updates)
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Proposal update error:", err);
    return NextResponse.json(
      { error: "Update failed" },
      { status: 500 }
    );
  }
}
