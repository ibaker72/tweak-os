"use client";

import { useEffect, useState } from "react";
import { Loader2, Send, CalendarClock, ArrowLeft, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import type { GrowthDraft } from "@/types/growth";

export default function PublishQueuePage() {
  const [drafts, setDrafts] = useState<GrowthDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishUrl, setPublishUrl] = useState("");
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");

  useEffect(() => {
    fetchDrafts();
  }, []);

  async function fetchDrafts() {
    try {
      setLoading(true);
      const res = await fetch("/api/growth/drafts?status=approved,scheduled");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      const all = Array.isArray(data) ? data : data.drafts ?? [];
      setDrafts(all.filter((d: GrowthDraft) => d.status === "approved" || d.status === "scheduled")
        .sort((a: GrowthDraft, b: GrowthDraft) => {
          if (a.scheduled_for && b.scheduled_for) return a.scheduled_for.localeCompare(b.scheduled_for);
          if (a.scheduled_for) return -1;
          if (b.scheduled_for) return 1;
          return 0;
        }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handlePublish(id: string) {
    if (!publishUrl.trim()) return;
    try {
      await fetch(`/api/growth/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "published",
          published_url: publishUrl,
          published_at: new Date().toISOString(),
        }),
      });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      setPublishingId(null);
      setPublishUrl("");
    } catch (err) {
      console.error(err);
    }
  }

  async function handleReschedule(id: string) {
    if (!rescheduleDate) return;
    try {
      await fetch(`/api/growth/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "scheduled",
          scheduled_for: new Date(rescheduleDate).toISOString(),
        }),
      });
      setDrafts((prev) =>
        prev.map((d) => d.id === id ? { ...d, status: "scheduled" as const, scheduled_for: rescheduleDate } : d)
      );
      setReschedulingId(null);
      setRescheduleDate("");
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSendToReview(id: string) {
    try {
      await fetch(`/api/growth/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "review" }),
      });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error(err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl">Publish Queue</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Content ready to go live — {drafts.length} item{drafts.length !== 1 ? "s" : ""}
        </p>
      </div>

      {drafts.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nothing in the publish queue"
          description="Approve drafts to add them to the publish queue."
          action={{ label: "View Drafts", href: "/growth/drafts" }}
        />
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <div key={draft.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-zinc-200">{draft.title}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 sm:gap-3">
                    {draft.opportunity?.keyword && (
                      <span className="text-xs text-zinc-500">{draft.opportunity.keyword}</span>
                    )}
                    {draft.scheduled_for && (
                      <span className="flex items-center gap-1 text-xs text-blue-400">
                        <CalendarClock className="h-3 w-3" />
                        {formatDate(draft.scheduled_for)}
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">{draft.word_count} words</span>
                    <StatusBadge status={draft.status} size="sm" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => {
                      setPublishingId(publishingId === draft.id ? null : draft.id);
                      setReschedulingId(null);
                    }}
                  >
                    <Send className="h-3 w-3" />
                    Publish
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReschedulingId(reschedulingId === draft.id ? null : draft.id);
                      setPublishingId(null);
                    }}
                  >
                    <CalendarClock className="h-3 w-3" />
                    <span className="hidden sm:inline">Reschedule</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleSendToReview(draft.id)}>
                    <ArrowLeft className="h-3 w-3" />
                    <span className="hidden sm:inline">Review</span>
                  </Button>
                </div>
              </div>

              {/* Publish form */}
              {publishingId === draft.id && (
                <div className="mt-3 flex flex-col gap-2 border-t border-zinc-800 pt-3 sm:flex-row sm:items-end sm:gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-zinc-500">Published URL</label>
                    <Input
                      value={publishUrl}
                      onChange={(e) => setPublishUrl(e.target.value)}
                      placeholder="https://tweakandbuild.com/blog/..."
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                  <Button size="sm" onClick={() => handlePublish(draft.id)} disabled={!publishUrl.trim()}>
                    <Check className="h-3 w-3" />
                    Confirm
                  </Button>
                </div>
              )}

              {/* Reschedule form */}
              {reschedulingId === draft.id && (
                <div className="mt-3 flex flex-col gap-2 border-t border-zinc-800 pt-3 sm:flex-row sm:items-end sm:gap-3">
                  <div>
                    <label className="text-xs text-zinc-500">New Date</label>
                    <Input
                      type="date"
                      value={rescheduleDate}
                      onChange={(e) => setRescheduleDate(e.target.value)}
                      className="mt-1 text-xs"
                    />
                  </div>
                  <Button size="sm" onClick={() => handleReschedule(draft.id)} disabled={!rescheduleDate}>
                    <Check className="h-3 w-3" />
                    Confirm
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
