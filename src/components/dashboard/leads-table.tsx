"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead, LifecycleStatus } from "@/lib/leads/types";
import { getScoreColor } from "@/lib/leads/scoring";
import {
  LifecycleStatusBadge,
  EnrichmentStatusBadge,
} from "./lead-status-badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { truncate } from "@/lib/utils";
import {
  Trash2,
  RefreshCw,
  Download,
  CheckSquare,
  Square,
} from "lucide-react";

interface LeadsTableProps {
  leads: Lead[];
}

export function LeadsTable({ leads }: LeadsTableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [processing, setProcessing] = useState(false);

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

  async function handleBulkAction() {
    if (selected.size === 0 || !bulkAction) return;
    setProcessing(true);

    const ids = [...selected];
    try {
      if (bulkAction === "delete") {
        await fetch("/api/leads", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
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
        // Status change
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
    } finally {
      setProcessing(false);
    }
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
        <p className="text-sm text-zinc-400">No leads found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2">
          <span className="text-sm text-zinc-300">
            {selected.size} selected
          </span>
          <Select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            className="w-44 text-xs"
          >
            <option value="">Choose action...</option>
            <option value="contacted">Mark Contacted</option>
            <option value="replied">Mark Replied</option>
            <option value="meeting_booked">Mark Meeting Booked</option>
            <option value="won">Mark Won</option>
            <option value="lost">Mark Lost</option>
            <option value="not_a_fit">Mark Not a Fit</option>
            <option value="re-enrich">Re-enrich</option>
            <option value="export">Export to CSV</option>
            <option value="delete">Delete</option>
          </Select>
          <Button
            size="sm"
            onClick={handleBulkAction}
            disabled={!bulkAction || processing}
          >
            {processing ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Apply"}
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80">
              <th className="w-10 px-3 py-3">
                <button
                  onClick={toggleSelectAll}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  {selected.size === leads.length ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                </button>
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Business
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
                Score
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Location
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Industry
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Tech Stack
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Contact
              </th>
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
                  >
                    {selected.has(lead.id) ? (
                      <CheckSquare className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </td>
                <td
                  className="px-4 py-3"
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
                  className="px-4 py-3 text-center"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  <ScoreIndicator score={lead.score} />
                </td>
                <td
                  className="px-4 py-3 text-sm text-zinc-400"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {[lead.city, lead.state].filter(Boolean).join(", ") || "—"}
                </td>
                <td
                  className="px-4 py-3 text-sm text-zinc-400"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.niche || "—"}
                </td>
                <td
                  className="px-4 py-3"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  <div className="flex flex-wrap gap-1">
                    {(lead.tech_stack || []).slice(0, 2).map((tech) => (
                      <Badge key={tech} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {tech}
                      </Badge>
                    ))}
                    {(lead.tech_stack || []).length > 2 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        +{lead.tech_stack.length - 2}
                      </Badge>
                    )}
                  </div>
                </td>
                <td
                  className="px-4 py-3 text-center"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  <LifecycleStatusBadge status={lead.lifecycle_status} />
                </td>
                <td
                  className="px-4 py-3 text-sm text-zinc-400"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.email || lead.email_1 || lead.phone || lead.phone_1 || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
