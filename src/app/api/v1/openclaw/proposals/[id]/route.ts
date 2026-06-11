import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { guard } from "@/lib/openclaw/auth";
import { logOpenClawAction } from "@/lib/openclaw/activity";
import {
  ARCHIVED_STATUS,
  MANAGED_PROPOSAL_STATUSES,
  OBSOLETE_STATUS,
  findObsoletableLaunchKitIds,
  type ManagedProposalRow,
} from "@/lib/proposals/management";

export const runtime = "nodejs";

const patchSchema = z.object({
  status: z.enum(MANAGED_PROPOSAL_STATUSES).optional(),
  reason: z.string().max(2000).optional(),
});

interface ProposalRow extends ManagedProposalRow {
  archived_at?: string | null;
}

const PROPOSAL_SELECT =
  "id, lead_id, status, services_json, client_name, created_at, archived_at";

async function loadProposal(
  supabase: ReturnType<typeof createServiceClient>,
  id: string
): Promise<ProposalRow | null> {
  const { data, error } = await supabase
    .from("proposals")
    .select(PROPOSAL_SELECT)
    .eq("id", id)
    .maybeSingle<ProposalRow>();
  if (error) {
    console.error("[openclaw] proposal lookup error:", error);
    throw error;
  }
  return data ?? null;
}

async function obsoleteOlderLaunchKitProposals(
  supabase: ReturnType<typeof createServiceClient>,
  activatedRow: ProposalRow
): Promise<string[]> {
  if (!activatedRow.lead_id) return [];

  const { data: leadProposals, error } = await supabase
    .from("proposals")
    .select(PROPOSAL_SELECT)
    .eq("lead_id", activatedRow.lead_id)
    .returns<ProposalRow[]>();
  if (error) {
    console.error("[openclaw] lead proposals lookup error:", error);
    return [];
  }

  const ids = findObsoletableLaunchKitIds({
    activatedRow,
    allRows: leadProposals ?? [],
  });
  if (ids.length === 0) return [];

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("proposals")
    .update({ status: OBSOLETE_STATUS, last_edited_at: now } as unknown as never)
    .in("id", ids);
  if (updateErr) {
    console.error("[openclaw] obsolete update error:", updateErr);
    return [];
  }
  return ids;
}

export async function PATCH(
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.issues },
      { status: 400 }
    );
  }

  if (!parsed.data.status) {
    return NextResponse.json(
      { error: "No updatable fields provided" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  let existing: ProposalRow | null;
  try {
    existing = await loadProposal(supabase, id);
  } catch {
    return NextResponse.json({ error: "Failed to load proposal" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const previousStatus = existing.status as string;
  const nextStatus = parsed.data.status;
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: nextStatus,
    last_edited_at: now,
  };
  if (nextStatus === ARCHIVED_STATUS) {
    update.archived_at = now;
  } else if (previousStatus === ARCHIVED_STATUS) {
    // Lifting a proposal back out of archived state clears the timestamp.
    update.archived_at = null;
  }

  const { error: updateErr } = await supabase
    .from("proposals")
    .update(update as unknown as never)
    .eq("id", id);
  if (updateErr) {
    console.error("[openclaw] proposal update error:", updateErr);
    return NextResponse.json(
      { error: "Failed to update proposal" },
      { status: 500 }
    );
  }

  const activatedRow: ProposalRow = { ...existing, status: nextStatus };
  let obsoletedIds: string[] = [];
  if (nextStatus === "active") {
    obsoletedIds = await obsoleteOlderLaunchKitProposals(supabase, activatedRow);
  }

  if (existing.lead_id) {
    await logOpenClawAction(supabase, existing.lead_id, "proposal.updated", {
      proposal_id: id,
      previous_status: previousStatus,
      next_status: nextStatus,
      reason: parsed.data.reason ?? null,
      obsoleted_proposal_ids: obsoletedIds,
    });
    if (obsoletedIds.length > 0) {
      await logOpenClawAction(
        supabase,
        existing.lead_id,
        "proposal.obsoleted",
        {
          activated_proposal_id: id,
          obsoleted_proposal_ids: obsoletedIds,
          reason: "superseded_by_active_launch_kit",
        }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    proposal_id: id,
    status: nextStatus,
    previous_status: previousStatus,
    obsoleted_proposal_ids: obsoletedIds,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const check = guard(request);
  if (!check.ok) return check.response;

  const { id } = await params;
  const supabase = createServiceClient();

  let existing: ProposalRow | null;
  try {
    existing = await loadProposal(supabase, id);
  } catch {
    return NextResponse.json({ error: "Failed to load proposal" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  const previousStatus = existing.status as string;
  if (previousStatus === ARCHIVED_STATUS) {
    return NextResponse.json({
      ok: true,
      proposal_id: id,
      status: ARCHIVED_STATUS,
      previous_status: previousStatus,
      already_archived: true,
    });
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("proposals")
    .update({
      status: ARCHIVED_STATUS,
      archived_at: now,
      last_edited_at: now,
    } as unknown as never)
    .eq("id", id);
  if (updateErr) {
    console.error("[openclaw] proposal archive error:", updateErr);
    return NextResponse.json(
      { error: "Failed to archive proposal" },
      { status: 500 }
    );
  }

  if (existing.lead_id) {
    await logOpenClawAction(supabase, existing.lead_id, "proposal.archived", {
      proposal_id: id,
      previous_status: previousStatus,
      soft_delete: true,
    });
  }

  return NextResponse.json({
    ok: true,
    proposal_id: id,
    status: ARCHIVED_STATUS,
    previous_status: previousStatus,
    soft_delete: true,
  });
}
