import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { leadUpdateSchema } from "@/lib/validators/lead";
import {
  updateLeadStatus,
  updateLeadNotes,
  updateLeadScore,
  deleteLeads,
  bulkUpdateLeadStatus,
  logActivity,
} from "@/lib/leads/mutations";
import { z } from "zod";

// PATCH /api/leads — update a single lead
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const validated = leadUpdateSchema.parse(updates);

    // If lifecycle_status changes to "contacted", handle outreach tracking
    if (validated.lifecycle_status === "contacted") {
      const contactedVia = body.last_contacted_via ?? null;
      const updatePayload: Record<string, unknown> = {
        ...validated,
        contacted_at: new Date().toISOString(),
      };
      if (contactedVia) {
        updatePayload.last_contacted_via = contactedVia;
      }

      // Increment follow_up_count
      const { data: currentLead } = await supabase
        .from("leads")
        .select("follow_up_count")
        .eq("id", id)
        .single();
      updatePayload.follow_up_count = ((currentLead?.follow_up_count as number) ?? 0) + 1;

      const { error: updateErr } = await supabase
        .from("leads")
        .update(updatePayload)
        .eq("id", id);
      if (updateErr) throw updateErr;

      // Auto-create outreach sequence entry
      const channel = contactedVia || "email";
      await supabase.from("outreach_sequences").insert({
        lead_id: id,
        channel,
        status: "sent",
        sent_at: new Date().toISOString(),
        sequence_step: ((currentLead?.follow_up_count as number) ?? 0) + 1,
      });
    } else {
      const { error } = await supabase
        .from("leads")
        .update(validated)
        .eq("id", id);
      if (error) throw error;
    }

    // Log activity
    await logActivity(supabase, id, "updated", validated);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Lead update error:", err);
    return NextResponse.json(
      { error: "Update failed" },
      { status: 500 }
    );
  }
}

// DELETE /api/leads — delete leads
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }

    await deleteLeads(supabase, ids);

    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (err) {
    console.error("Lead delete error:", err);
    return NextResponse.json(
      { error: "Delete failed" },
      { status: 500 }
    );
  }
}

// PUT /api/leads — bulk status update
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { ids, lifecycle_status } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }

    if (!lifecycle_status) {
      return NextResponse.json(
        { error: "lifecycle_status is required" },
        { status: 400 }
      );
    }

    await bulkUpdateLeadStatus(supabase, ids, lifecycle_status);

    return NextResponse.json({
      success: true,
      updated: ids.length,
    });
  } catch (err) {
    console.error("Bulk update error:", err);
    return NextResponse.json(
      { error: "Bulk update failed" },
      { status: 500 }
    );
  }
}
