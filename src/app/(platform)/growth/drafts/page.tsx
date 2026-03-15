"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Loader2, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ScoreIndicator } from "@/components/shared/ScoreIndicator";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatDate } from "@/lib/utils";
import { DRAFT_STATUSES } from "@/lib/shared/constants";
import type { GrowthDraft } from "@/types/growth";

export default function DraftsPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<GrowthDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

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

  async function handleDelete(id: string) {
    if (!confirm("Delete this draft?")) return;
    try {
      await fetch(`/api/growth/drafts/${id}`, { method: "DELETE" });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error(err);
    }
  }

  const filtered = drafts.filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false;
    if (searchQuery && !d.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Drafts</h1>
          <p className="text-sm text-zinc-400 mt-1">{drafts.length} total drafts</p>
        </div>
        <Button size="sm" onClick={() => router.push("/growth/drafts/new")}>
          <Plus className="h-4 w-4" />
          New Draft
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Search drafts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-40"
        >
          <option value="">All Statuses</option>
          {DRAFT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No drafts yet"
          description="Create your first content draft to start building your inbound pipeline."
          action={{ label: "New Draft", href: "/growth/drafts/new" }}
        />
      ) : (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Title</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Keyword</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">Words</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">SEO</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Updated</th>
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
                  <td className="px-4 py-3">
                    <p className="text-zinc-200 font-medium">{draft.title}</p>
                    {draft.slug && <p className="text-xs text-zinc-500">/{draft.slug}</p>}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{draft.opportunity?.keyword ?? "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={draft.status} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-center text-zinc-400">{draft.word_count || "—"}</td>
                  <td className="px-4 py-3 text-center">
                    {draft.seo_score > 0 ? (
                      <ScoreIndicator score={draft.seo_score} size="sm" />
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">{formatDate(draft.updated_at)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(draft.id)}>
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
