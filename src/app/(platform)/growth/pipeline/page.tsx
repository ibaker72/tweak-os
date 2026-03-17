"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LayoutList, FileText, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PIPELINE_STAGES, DRAFT_STATUSES } from "@/lib/shared/constants";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import type { GrowthDraft } from "@/types/growth";

type StageFilter = "all" | string;
type ViewMode = "list" | "board";

const STAGE_COLORS: Record<string, string> = {
  discovered: "border-t-zinc-600",
  planned: "border-t-zinc-500",
  in_progress: "border-t-amber-500",
  review: "border-t-amber-500",
  approved: "border-t-blue-500",
  scheduled: "border-t-blue-500",
  published: "border-t-emerald-500",
};

export default function PipelinePage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<GrowthDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  useEffect(() => {
    fetchDrafts();
  }, []);

  async function fetchDrafts() {
    try {
      setLoading(true);
      const res = await fetch("/api/growth/drafts");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setDrafts(Array.isArray(data) ? data : data.drafts ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    try {
      await fetch(`/api/growth/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, status: status as GrowthDraft["status"] } : d)));
    } catch (err) {
      console.error(err);
    }
  }

  function daysInStage(draft: GrowthDraft): number {
    const updated = new Date(draft.updated_at);
    const now = new Date();
    return Math.floor((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24));
  }

  const filtered = stageFilter === "all" ? drafts : drafts.filter((d) => d.status === stageFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl">Content Pipeline</h1>
          <p className="mt-1 text-sm text-zinc-400">Track content through each stage</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "list" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-300"
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
              List
            </button>
            <button
              onClick={() => setViewMode("board")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                viewMode === "board" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-300"
              )}
            >
              <Columns3 className="h-3.5 w-3.5" />
              Board
            </button>
          </div>
          <Button size="sm" onClick={() => router.push("/growth/drafts/new")}>
            <FileText className="h-4 w-4" />
            New Draft
          </Button>
        </div>
      </div>

      {/* Stage filter tabs (only in list view) */}
      {viewMode === "list" && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStageFilter("all")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              stageFilter === "all" ? "bg-emerald-500/10 text-emerald-400" : "text-zinc-400 hover:bg-zinc-800"
            )}
          >
            All ({drafts.length})
          </button>
          {PIPELINE_STAGES.map((stage) => {
            const count = drafts.filter((d) => d.status === stage.key).length;
            return (
              <button
                key={stage.key}
                onClick={() => setStageFilter(stage.key)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  stageFilter === stage.key ? "bg-emerald-500/10 text-emerald-400" : "text-zinc-400 hover:bg-zinc-800"
                )}
              >
                {stage.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === "list" && (
        <>
          {filtered.length === 0 ? (
            <EmptyState
              icon={LayoutList}
              title="No content in this stage"
              description="Create drafts or move existing content through the pipeline."
              action={{ label: "New Draft", href: "/growth/drafts/new" }}
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-800">
              <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="bg-zinc-900/80 border-b border-zinc-800">
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Keyword</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Type</th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">Stage</th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">Words</th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">Days</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {filtered.map((draft) => (
                    <tr
                      key={draft.id}
                      className="hover:bg-zinc-800/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/growth/drafts/${draft.id}`)}
                    >
                      <td className="px-4 py-3 text-zinc-200 font-medium">{draft.title}</td>
                      <td className="px-4 py-3 text-zinc-400">{draft.opportunity?.keyword ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-400 capitalize">{(draft.brief?.content_type ?? "—").replace("_", " ")}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={draft.status} size="sm" />
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-400">{draft.word_count || "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("text-xs font-medium", daysInStage(draft) > 7 ? "text-amber-400" : "text-zinc-400")}>
                          {daysInStage(draft)}d
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={draft.status}
                          onChange={(e) => updateStatus(draft.id, e.target.value)}
                          className="h-7 text-xs w-32"
                        >
                          {DRAFT_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Board View */}
      {viewMode === "board" && (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4" style={{ minWidth: `${PIPELINE_STAGES.length * 260}px` }}>
            {PIPELINE_STAGES.map((stage) => {
              const stageDrafts = drafts.filter((d) => d.status === stage.key);
              return (
                <div key={stage.key} className="flex-1 min-w-[240px]">
                  <div
                    className={cn(
                      "rounded-t-lg border border-zinc-800 border-t-2 bg-zinc-900/50 px-3 py-2",
                      STAGE_COLORS[stage.key] ?? "border-t-zinc-600"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-zinc-300">{stage.label}</span>
                      <Badge variant="secondary" className="text-[10px] tabular-nums">
                        {stageDrafts.length}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2 rounded-b-lg border border-t-0 border-zinc-800 bg-zinc-950/50 p-2 min-h-[120px]">
                    {stageDrafts.length === 0 ? (
                      <p className="py-6 text-center text-xs text-zinc-600">No items</p>
                    ) : (
                      stageDrafts.map((draft) => (
                        <div
                          key={draft.id}
                          className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 p-3 transition-colors hover:border-zinc-700"
                          onClick={() => router.push(`/growth/drafts/${draft.id}`)}
                        >
                          <p className="text-sm font-medium text-zinc-200 line-clamp-2">{draft.title}</p>
                          {draft.opportunity?.keyword && (
                            <p className="mt-1 text-xs text-zinc-500 truncate">{draft.opportunity.keyword}</p>
                          )}
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-zinc-500">
                              {draft.word_count ? `${draft.word_count}w` : "—"}
                            </span>
                            <span
                              className={cn(
                                "text-xs font-medium",
                                daysInStage(draft) > 7 ? "text-amber-400" : "text-zinc-500"
                              )}
                            >
                              {daysInStage(draft)}d
                            </span>
                          </div>
                          <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                            <Select
                              value={draft.status}
                              onChange={(e) => updateStatus(draft.id, e.target.value)}
                              className="h-7 text-xs w-full"
                            >
                              {DRAFT_STATUSES.map((s) => (
                                <option key={s.value} value={s.value}>{s.label}</option>
                              ))}
                            </Select>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
