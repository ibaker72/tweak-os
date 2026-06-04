import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// GET /api/proposals — list recent proposals
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("proposals")
      .select(
        "id, lead_id, client_name, business_type, services_json, proposal_html, total_one_time, total_monthly, status, created_at"
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

const saveSchema = z.object({
  client_name: z.string().default(""),
  business_type: z.string().default(""),
  selected_services: z.array(serviceSchema).default([]),
  proposal_html: z.string().default(""),
  lead_id: z.string().uuid().optional(),
});

// POST /api/proposals — save a proposal explicitly (e.g. from "Save Proposal" button)
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

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("proposals")
      .insert({
        lead_id: input.lead_id ?? null,
        client_name: input.client_name || null,
        business_type: input.business_type || null,
        services_json: input.selected_services,
        proposal_html: input.proposal_html,
        total_one_time,
        total_monthly,
        status: "draft",
      })
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
  status: z.enum(["draft", "sent", "won", "lost"]).optional(),
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
