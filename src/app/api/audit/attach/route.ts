import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  audit_id: z.string().uuid(),
  lead_id: z.string().uuid(),
});

// POST /api/audit/attach — attach an existing audit to a lead
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { audit_id, lead_id } = inputSchema.parse(body);

    const supabase = await createClient();
    const { error } = await supabase
      .from("lead_audits")
      .update({ lead_id })
      .eq("id", audit_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Audit attach error:", err);
    return NextResponse.json(
      { error: "Attach failed" },
      { status: 500 }
    );
  }
}
