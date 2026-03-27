import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createSequenceEntry,
  getSequenceForLead,
  getDueSequences,
  markSequenceSent,
  markSequenceReplied,
} from "@/lib/leads/sequences";
import { z } from "zod";

const createSequenceSchema = z.object({
  lead_id: z.string().uuid(),
  agent_id: z.string().uuid().optional(),
  channel: z.enum(["email", "linkedin", "phone", "other"]),
  subject: z.string().optional(),
  body: z.string().optional(),
  status: z.enum(["draft", "sent"]).optional(),
  scheduled_for: z.string().optional(),
  notes: z.string().optional(),
});

const updateSequenceSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["sent", "opened", "replied", "bounced"]),
});

// GET /api/outreach/sequences — get sequences by lead_id or agent_id or due today
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get("lead_id");
    const agentId = searchParams.get("agent_id");
    const due = searchParams.get("due");

    if (due === "today") {
      const sequences = await getDueSequences(supabase, agentId ?? undefined);
      return NextResponse.json({ sequences });
    }

    if (leadId) {
      const sequences = await getSequenceForLead(supabase, leadId);
      return NextResponse.json({ sequences });
    }

    if (agentId) {
      const { data, error } = await supabase
        .from("outreach_sequences")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return NextResponse.json({ sequences: data ?? [] });
    }

    return NextResponse.json({ error: "lead_id, agent_id, or due=today required" }, { status: 400 });
  } catch (err) {
    console.error("Sequences GET error:", err);
    return NextResponse.json({ error: "Failed to fetch sequences" }, { status: 500 });
  }
}

// POST /api/outreach/sequences — create a new sequence entry
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const validated = createSequenceSchema.parse(body);

    const entry = await createSequenceEntry(supabase, validated);
    return NextResponse.json({ sequence: entry }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Sequences POST error:", err);
    return NextResponse.json({ error: "Failed to create sequence" }, { status: 500 });
  }
}

// PATCH /api/outreach/sequences — update sequence status
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, status } = updateSequenceSchema.parse(body);

    if (status === "sent") {
      await markSequenceSent(supabase, id);
    } else if (status === "replied") {
      await markSequenceReplied(supabase, id);
    } else {
      const updateData: Record<string, unknown> = { status };
      if (status === "opened") updateData.opened_at = new Date().toISOString();
      const { error } = await supabase
        .from("outreach_sequences")
        .update(updateData)
        .eq("id", id);
      if (error) throw error;
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Sequences PATCH error:", err);
    return NextResponse.json({ error: "Failed to update sequence" }, { status: 500 });
  }
}
