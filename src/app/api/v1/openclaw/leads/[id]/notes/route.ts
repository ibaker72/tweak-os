import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { guard } from "@/lib/openclaw/auth";
import { logOpenClawAction } from "@/lib/openclaw/activity";

export const runtime = "nodejs";

const noteSchema = z.object({
  note: z.string().min(1).max(5000),
  type: z.enum(["openclaw", "call", "sms", "email", "research"]).default("openclaw"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = guard(request);
  if (!check.ok) return check.response;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { data: existing, error: existingErr } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existingErr) {
    console.error("[openclaw] lead lookup error:", existingErr);
    return NextResponse.json({ error: "Failed to load lead" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const action = `openclaw:note.${parsed.data.type}`;
  const { data, error } = await supabase
    .from("activity_log")
    .insert({
      lead_id: id,
      action,
      details: { note: parsed.data.note, type: parsed.data.type, source: "openclaw" },
    } as unknown as never)
    .select("id, created_at")
    .single<{ id: string; created_at: string }>();

  if (error) {
    console.error("[openclaw] note insert error:", error);
    return NextResponse.json({ error: "Failed to save note" }, { status: 500 });
  }

  // Best-effort: surface the latest note on the lead row too, so the UI
  // shows it without clicking into history.
  await logOpenClawAction(supabase, id, "note.added", {
    type: parsed.data.type,
    length: parsed.data.note.length,
  });

  return NextResponse.json({
    ok: true,
    lead_id: id,
    note: {
      id: data.id,
      type: parsed.data.type,
      note: parsed.data.note,
      created_at: data.created_at,
    },
  });
}
