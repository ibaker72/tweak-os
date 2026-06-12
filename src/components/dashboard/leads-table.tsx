"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Lead, LifecycleStatus } from "@/lib/leads/types";
import type { LeadView } from "@/lib/validators/lead";
import type { OpportunityGrade } from "@/lib/audits/types";
import {
  LifecycleStatusBadge,
} from "./lead-status-badge";
import { OpportunityGradeBadge } from "@/components/audit/OpportunityGradeBadge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { LeadActionMenu } from "@/components/leads/lead-action-menu";
import { truncate } from "@/lib/utils";
import {
  RefreshCw,
  CheckSquare,
  Square,
  UserCircle,
} from "lucide-react";

interface AuditSummary {
  id: string;
  opportunity_grade: string | null;
  overall_score: number | null;
}

interface LeadsTableProps {
  leads: Lead[];
  agents?: { id: string; display_name: string }[];
  auditsByLeadId?: Record<string, AuditSummary>;
  view?: LeadView;
}

export function LeadsTable({
  leads,
  agents = [],
  auditsByLeadId = {},
  view = "active",
}: LeadsTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [processing, setProcessing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isArchivedView = view === "archived";
  const isDeletedView = view === "deleted";

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  }

  async function postAction(action: "archive" | "restore" | "soft_delete" | "mark_contacted", ids: string[]) {
    const res = await fetch("/api/leads", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action }),
    });
    if (!res.ok) throw new Error("Request failed");
  }

  async function performBulkAction() {
    if (selected.size === 0 || !bulkAction) return;
    setProcessing(true);

    const ids = [...selected];
    try {
      if (bulkAction === "delete") {
        // Bulk delete is gated through the confirmation dialog instead.
        setConfirmDelete(true);
        setProcessing(false);
        return;
      } else if (bulkAction === "archive") {
        await postAction("archive", ids);
        toast(`${ids.length} lead${ids.length === 1 ? "" : "s"} archived`, "success");
      } else if (bulkAction === "restore") {
        await postAction("restore", ids);
        toast(`${ids.length} lead${ids.length === 1 ? "" : "s"} restored`, "success");
      } else if (bulkAction === "contacted") {
        await postAction("mark_contacted", ids);
        toast(`${ids.length} lead${ids.length === 1 ? "" : "s"} marked contacted`, "success");
      } else if (bulkAction.startsWith("assign:")) {
        const agentId = bulkAction.replace("assign:", "");
        await fetch("/api/leads/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_ids: ids, agent_id: agentId }),
        });
      } else if (bulkAction === "auto-assign") {
        await fetch("/api/leads/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_ids: ids, mode: "round_robin" }),
        });
      } else if (bulkAction === "re-enrich") {
        await fetch("/api/enrich-bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lead_ids: ids }),
        });
      } else if (bulkAction === "export") {
        window.open("/api/exports", "_blank");
      } else {
        await fetch("/api/leads", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, lifecycle_status: bulkAction }),
        });
      }
      setSelected(new Set());
      setBulkAction("");
      router.refresh();
    } catch (err) {
      console.error("Bulk action error:", err);
      const errorMessage =
        bulkAction === "archive"
          ? "Could not archive leads"
          : bulkAction === "restore"
            ? "Could not restore leads"
            : "Could not update leads";
      toast(errorMessage, "error");
    } finally {
      setProcessing(false);
    }
  }

  async function confirmBulkDelete() {
    const ids = [...selected];
    setProcessing(true);
    try {
      await postAction("soft_delete", ids);
      toast(`${ids.length} lead${ids.length === 1 ? "" : "s"} deleted`, "success");
      setSelected(new Set());
      setBulkAction("");
      setConfirmDelete(false);
      router.refresh();
    } catch (err) {
      console.error("Bulk delete error:", err);
      toast("Could not delete leads", "error");
    } finally {
      setProcessing(false);
    }
  }

  if (leads.length === 0) {
    const emptyText =
      view === "archived"
        ? "No archived leads"
        : view === "deleted"
          ? "No deleted leads"
          : "No leads found";
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center sm:p-12">
        <p className="text-sm text-zinc-400">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 sm:gap-3 sm:px-4">
          <span className="text-sm text-zinc-300">
            {selected.size} selected on this page
          </span>
          <Select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            className="w-44 text-xs sm:w-52"
            aria-label="Bulk action"
          >
            <option value="">Choose action...</option>
            {(isArchivedView || isDeletedView) && (
              <option value="restore">Restore selected</option>
            )}
            {!isArchivedView && !isDeletedView && (
              <>
                <option value="archive">Archive selected</option>
                <option value="contacted">Mark Contacted</option>
                <option value="replied">Mark Replied</option>
                <option value="meeting_booked">Mark Meeting Booked</option>
                <option value="won">Mark Won</option>
                <option value="lost">Mark Lost</option>
                <option value="not_a_fit">Mark Not a Fit</option>
              </>
            )}
            {agents.length > 0 && !isDeletedView && (
              <optgroup label="Assign to Agent">
                {agents.map((a) => (
                  <option key={a.id} value={`assign:${a.id}`}>{a.display_name}</option>
                ))}
              </optgroup>
            )}
            {!isDeletedView && (
              <>
                <option value="auto-assign">Auto-Assign (Round Robin)</option>
                <option value="re-enrich">Re-enrich</option>
              </>
            )}
            <option value="export">Export to CSV</option>
            <option value="delete">Delete selected</option>
          </Select>
          <Button
            size="sm"
            onClick={performBulkAction}
            disabled={!bulkAction || processing}
          >
            {processing ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Apply"}
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-zinc-500 hover:text-zinc-300"
            type="button"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Mobile card view */}
      <div className="space-y-2 md:hidden">
        {leads.map((lead) => (
          <div
            key={lead.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
          >
            <div className="flex items-start gap-3">
              <button
                onClick={() => toggleSelect(lead.id)}
                className="mt-1 text-zinc-500 hover:text-zinc-300"
                aria-label={selected.has(lead.id) ? "Deselect lead" : "Select lead"}
              >
                {selected.has(lead.id) ? (
                  <CheckSquare className="h-5 w-5 text-lime-400" />
                ) : (
                  <Square className="h-5 w-5" />
                )}
              </button>
              <Link href={`/leads/${lead.id}`} className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-zinc-50">
                  {lead.business_name}
                </p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  {[lead.city, lead.state].filter(Boolean).join(", ") || lead.website?.replace(/https?:\/\//, "") || "—"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ScoreIndicator score={lead.score} />
                  <LifecycleStatusBadge status={lead.lifecycle_status as LifecycleStatus} />
                  {lead.niche && (
                    <Badge variant="secondary" className="text-[10px]">
                      {truncate(lead.niche, 20)}
                    </Badge>
                  )}
                  {lead.source === "NJ Business Records" && (
                    <Badge variant="info" className="text-[10px]">NJ</Badge>
                  )}
                </div>
              </Link>
              <LeadActionMenu
                leadId={lead.id}
                hasWebsite={!!lead.website}
                alreadyContacted={lead.lifecycle_status === "contacted"}
                showRestore={isArchivedView || isDeletedView}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-zinc-800 md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/80">
                <th className="w-10 px-3 py-3">
                  <button
                    onClick={toggleSelectAll}
                    className="text-zinc-500 hover:text-zinc-300"
                    aria-label={
                      selected.size === leads.length
                        ? "Deselect all"
                        : "Select all on this page"
                    }
                  >
                    {selected.size === leads.length ? (
                      <CheckSquare className="h-4 w-4" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400 sm:px-4">
                  Business
                </th>
                <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400 sm:px-4">
                  Score
                </th>
                <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400 sm:px-4">
                  Opp Score
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400 sm:px-4">
                  Location
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400 sm:px-4">
                  Industry
                </th>
                <th className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400 md:table-cell sm:px-4">
                  Tech Stack
                </th>
                <th className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400 sm:px-4">
                  Status
                </th>
                <th className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400 lg:table-cell sm:px-4">
                  Assigned To
                </th>
                <th className="hidden px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400 xl:table-cell sm:px-4">
                  Contact
                </th>
                <th className="w-12 px-3 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="cursor-pointer bg-zinc-950 transition-colors hover:bg-zinc-900/50"
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => toggleSelect(lead.id)}
                      className="text-zinc-500 hover:text-zinc-300"
                      aria-label={selected.has(lead.id) ? "Deselect lead" : "Select lead"}
                    >
                      {selected.has(lead.id) ? (
                        <CheckSquare className="h-4 w-4 text-lime-400" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td
                    className="px-3 py-3 sm:px-4"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium text-zinc-50">
                        {truncate(lead.business_name, 30)}
                      </p>
                      {lead.website && (
                        <p className="text-xs text-zinc-500">
                          {truncate(lead.website.replace(/https?:\/\//, ""), 25)}
                        </p>
                      )}
                    </div>
                  </td>
                  <td
                    className="px-3 py-3 text-center sm:px-4"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <ScoreIndicator score={lead.score} />
                  </td>
                  <td
                    className="px-3 py-3 text-center sm:px-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <OppScoreCell
                      lead={lead}
                      audit={auditsByLeadId[lead.id]}
                    />
                  </td>
                  <td
                    className="px-3 py-3 text-sm text-zinc-400 sm:px-4"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    {[lead.city, lead.state].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td
                    className="px-3 py-3 text-sm text-zinc-400 sm:px-4"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    {lead.niche || "—"}
                  </td>
                  <td
                    className="hidden px-3 py-3 md:table-cell sm:px-4"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <div className="flex flex-wrap gap-1">
                      {(lead.tech_stack || []).slice(0, 2).map((tech) => (
                        <Badge key={tech} variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {tech}
                        </Badge>
                      ))}
                      {(lead.tech_stack || []).length > 2 && (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                          +{lead.tech_stack.length - 2}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td
                    className="px-3 py-3 text-center sm:px-4"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <LifecycleStatusBadge status={lead.lifecycle_status as LifecycleStatus} />
                  </td>
                  <td
                    className="hidden px-3 py-3 text-sm lg:table-cell sm:px-4"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    {(() => {
                      const assignedTo = (lead as unknown as Record<string, unknown>).assigned_to as string | null;
                      const agent = agents.find((a) => a.id === assignedTo);
                      return agent ? (
                        <span className="flex items-center gap-1.5 text-zinc-300">
                          <UserCircle className="h-3.5 w-3.5 text-lime-400" />
                          {agent.display_name}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      );
                    })()}
                  </td>
                  <td
                    className="hidden px-3 py-3 text-sm text-zinc-400 xl:table-cell sm:px-4"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    {lead.email || lead.email_1 || lead.phone || lead.phone_1 || "—"}
                  </td>
                  <td
                    className="px-3 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <LeadActionMenu
                      leadId={lead.id}
                      hasWebsite={!!lead.website}
                      alreadyContacted={lead.lifecycle_status === "contacted"}
                      showRestore={isArchivedView || isDeletedView}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(v) => {
          if (!processing) setConfirmDelete(v);
        }}
        title={`Delete ${selected.size} selected lead${selected.size === 1 ? "" : "s"}?`}
        description="Delete selected leads? This cannot be undone."
        confirmLabel="Delete"
        tone="destructive"
        busy={processing}
        onConfirm={confirmBulkDelete}
      />
    </div>
  );
}

function ScoreIndicator({ score }: { score: number }) {
  const color = score >= 70 ? "text-red-400" : score >= 40 ? "text-orange-400" : "text-blue-400";
  const bgColor = score >= 70 ? "bg-red-500/10" : score >= 40 ? "bg-orange-500/10" : "bg-blue-500/10";

  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${color} ${bgColor}`}>
      {score}
    </span>
  );
}

function OppScoreCell({
  lead,
  audit,
}: {
  lead: Lead;
  audit?: AuditSummary;
}) {
  if (audit?.opportunity_grade) {
    const grade = audit.opportunity_grade as OpportunityGrade;
    if (grade === "A+" || grade === "A" || grade === "B" || grade === "C") {
      return <OpportunityGradeBadge grade={grade} size="sm" />;
    }
  }
  if (lead.website) {
    const href = `/research?url=${encodeURIComponent(lead.website)}&lead_id=${lead.id}`;
    return (
      <Link
        href={href}
        className="text-xs text-zinc-500 hover:text-lime-400 transition-colors"
      >
        Audit →
      </Link>
    );
  }
  return <span className="text-xs text-zinc-600">—</span>;
}
