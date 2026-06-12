import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { leadUpdateSchema, leadActionSchema } from "@/lib/validators/lead";
import {
  deleteLeads,
  bulkUpdateLeadStatus,
  archiveLead,
  restoreLead,
  softDeleteLead,
  markLeadContacted,
  bulkArchiveLeads,
  bulkRestoreLeads,
  bulkSoftDeleteLeads,
  bulkMarkContacted,
  logActivity,
} from "@/lib/leads/mutations";
import { z } from "zod";

// PATCH /api/leads — update a single lead, or perform an action on it.
//
// Two shapes:
//   1. { id, action: "archive" | "restore" | "soft_delete" | "mark_contacted" }
//   2. { id, ...field updates }  (existing pattern, preserved for backward compat)
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, action, ...updates } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Action-based flow — single-lead archive/restore/soft_delete/mark_contacted.
    if (action) {
      const parsedAction = leadActionSchema.parse(action);
      if (parsedAction === "archive") {
        await archiveLead(supabase, id);
        await logActivity(supabase, id, "archived");
      } else if (parsedAction === "restore") {
        await restoreLead(supabase, id);
        await logActivity(supabase, id, "restored");
      } else if (parsedAction === "soft_delete") {
        await softDeleteLead(supabase, id);
        await logActivity(supabase, id, "soft_deleted");
      } else if (parsedAction === "mark_contacted") {
        await markLeadContacted(supabase, id);
        await logActivity(supabase, id, "marked_contacted");
      }
      return NextResponse.json({ success: true, action: parsedAction });
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

// DELETE /api/leads — soft delete leads by default; pass ?hard=true to
// permanently remove them.
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const hard = searchParams.get("hard") === "true";
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }

    if (hard) {
      await deleteLeads(supabase, ids);
      return NextResponse.json({ success: true, deleted: ids.length, hard: true });
    }

    await bulkSoftDeleteLeads(supabase, ids);
    for (const id of ids) {
      await logActivity(supabase, id, "soft_deleted");
    }
    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (err) {
    console.error("Lead delete error:", err);
    return NextResponse.json(
      { error: "Delete failed" },
      { status: 500 }
    );
  }
}

// PUT /api/leads — bulk update.
//
// Two shapes:
//   1. { ids, action: "archive" | "restore" | "soft_delete" | "mark_contacted" }
//   2. { ids, lifecycle_status: "<status>" }  (existing pattern)
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { ids, action, lifecycle_status } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids array is required" },
        { status: 400 }
      );
    }

    if (action) {
      const parsed = leadActionSchema.parse(action);
      if (parsed === "archive") {
        await bulkArchiveLeads(supabase, ids);
      } else if (parsed === "restore") {
        await bulkRestoreLeads(supabase, ids);
      } else if (parsed === "soft_delete") {
        await bulkSoftDeleteLeads(supabase, ids);
      } else if (parsed === "mark_contacted") {
        await bulkMarkContacted(supabase, ids);
      }
      for (const id of ids) {
        await logActivity(supabase, id, `bulk_${parsed}`);
      }
      return NextResponse.json({ success: true, action: parsed, updated: ids.length });
    }

    if (!lifecycle_status) {
      return NextResponse.json(
        { error: "lifecycle_status or action is required" },
        { status: 400 }
      );
    }

    await bulkUpdateLeadStatus(supabase, ids, lifecycle_status);

    return NextResponse.json({
      success: true,
      updated: ids.length,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Bulk update error:", err);
    return NextResponse.json(
      { error: "Bulk update failed" },
      { status: 500 }
    );
  }
}
