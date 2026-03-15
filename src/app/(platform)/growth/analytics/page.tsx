"use client";

import { useEffect, useState } from "react";
import { Loader2, BarChart3, Eye, MousePointerClick, Target, UserCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { GrowthDraft, GrowthDashboardStats } from "@/types/growth";

interface PerformanceEntry {
  draft_id: string;
  draft_title?: string;
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_position: number;
  page_views: number;
  conversions: number;
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<GrowthDashboardStats | null>(null);
  const [performance, setPerformance] = useState<PerformanceEntry[]>([]);
  const [publishedDrafts, setPublishedDrafts] = useState<GrowthDraft[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual entry form
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryDraftId, setEntryDraftId] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [entryImpressions, setEntryImpressions] = useState("");
  const [entryClicks, setEntryClicks] = useState("");
  const [entryPosition, setEntryPosition] = useState("");
  const [entryPageViews, setEntryPageViews] = useState("");
  const [entryConversions, setEntryConversions] = useState("");
  const [entrySaving, setEntrySaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      const [analyticsRes, draftsRes] = await Promise.all([
        fetch("/api/growth/analytics"),
        fetch("/api/growth/drafts?status=published"),
      ]);

      if (analyticsRes.ok) {
        const data = await analyticsRes.json();
        setStats(data.stats ?? data);
        setPerformance(data.performance ?? []);
      }
      if (draftsRes.ok) {
        const data = await draftsRes.json();
        setPublishedDrafts(Array.isArray(data) ? data : data.drafts ?? []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEntry() {
    if (!entryDraftId || !entryDate) return;
    try {
      setEntrySaving(true);
      const clicks = parseInt(entryClicks) || 0;
      const impressions = parseInt(entryImpressions) || 0;
      const res = await fetch("/api/growth/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft_id: entryDraftId,
          date: entryDate,
          impressions,
          clicks,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          avg_position: parseFloat(entryPosition) || 0,
          page_views: parseInt(entryPageViews) || 0,
          conversions: parseInt(entryConversions) || 0,
        }),
      });
      if (res.ok) {
        await fetchData();
        setShowEntryForm(false);
        setEntryImpressions("");
        setEntryClicks("");
        setEntryPosition("");
        setEntryPageViews("");
        setEntryConversions("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEntrySaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  // Find best and worst performing
  const draftPerformance = new Map<string, { impressions: number; clicks: number; title: string }>();
  for (const p of performance) {
    const existing = draftPerformance.get(p.draft_id) ?? { impressions: 0, clicks: 0, title: p.draft_title ?? "" };
    existing.impressions += p.impressions;
    existing.clicks += p.clicks;
    if (p.draft_title) existing.title = p.draft_title;
    draftPerformance.set(p.draft_id, existing);
  }
  const ranked = Array.from(draftPerformance.entries()).sort((a, b) => b[1].clicks - a[1].clicks);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl">Analytics</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Track performance of your published content
          </p>
        </div>
        <Button size="sm" onClick={() => setShowEntryForm(!showEntryForm)}>
          <Plus className="h-4 w-4" />
          Add Data
        </Button>
      </div>

      {/* Metric cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Impressions", value: stats.total_impressions.toLocaleString(), icon: Eye },
            { label: "Clicks", value: stats.total_clicks.toLocaleString(), icon: MousePointerClick },
            { label: "Avg CTR", value: stats.total_impressions > 0 ? `${((stats.total_clicks / stats.total_impressions) * 100).toFixed(1)}%` : "—", icon: Target },
            { label: "Avg Position", value: stats.avg_position > 0 ? stats.avg_position.toFixed(1) : "—", icon: BarChart3 },
            { label: "Conversions", value: String(stats.conversion_count), icon: UserCheck },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 sm:p-5">
              <div className="flex items-center justify-between">
                <p className="truncate text-xs text-zinc-400 sm:text-sm">{card.label}</p>
                <card.icon className="h-3.5 w-3.5 shrink-0 text-emerald-500 sm:h-4 sm:w-4" />
              </div>
              <p className="mt-2 text-xl font-bold text-zinc-50 sm:text-2xl">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Best/Worst */}
      {ranked.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {best && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-emerald-400">Best Performing</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-zinc-200 font-medium">{best[1].title || "Untitled"}</p>
                <p className="text-sm text-zinc-400 mt-1">{best[1].clicks} clicks, {best[1].impressions} impressions</p>
              </CardContent>
            </Card>
          )}
          {worst && ranked.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-red-400">Needs Improvement</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-zinc-200 font-medium">{worst[1].title || "Untitled"}</p>
                <p className="text-sm text-zinc-400 mt-1">{worst[1].clicks} clicks, {worst[1].impressions} impressions</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Manual entry form */}
      {showEntryForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Add Performance Data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-zinc-500">
              {/* TODO: Replace manual entry with GSC API — needs OAuth setup */}
              Enter data from Google Search Console and Google Analytics manually.
            </p>
            <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-zinc-400">Published Article</label>
                <Select value={entryDraftId} onChange={(e) => setEntryDraftId(e.target.value)} className="mt-1">
                  <option value="">Select article...</option>
                  {publishedDrafts.map((d) => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-400">Date</label>
                <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-5">
              <div>
                <label className="text-xs text-zinc-500">Impressions</label>
                <Input type="number" value={entryImpressions} onChange={(e) => setEntryImpressions(e.target.value)} className="mt-1" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Clicks</label>
                <Input type="number" value={entryClicks} onChange={(e) => setEntryClicks(e.target.value)} className="mt-1" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Avg Position</label>
                <Input type="number" step="0.1" value={entryPosition} onChange={(e) => setEntryPosition(e.target.value)} className="mt-1" placeholder="0.0" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Page Views</label>
                <Input type="number" value={entryPageViews} onChange={(e) => setEntryPageViews(e.target.value)} className="mt-1" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Conversions</label>
                <Input type="number" value={entryConversions} onChange={(e) => setEntryConversions(e.target.value)} className="mt-1" placeholder="0" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSaveEntry} disabled={entrySaving || !entryDraftId}>
                {entrySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button variant="ghost" onClick={() => setShowEntryForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Performance table */}
      {performance.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Article</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">Date</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-400">Impressions</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-400">Clicks</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-400">CTR</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-400">Position</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-400">Conversions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {performance.slice(0, 50).map((p, i) => (
                <tr key={i} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3 text-zinc-200">{p.draft_title || "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{p.date}</td>
                  <td className="px-4 py-3 text-right text-zinc-300">{p.impressions.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-zinc-300">{p.clicks.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-zinc-400">{p.ctr > 0 ? `${p.ctr.toFixed(1)}%` : "—"}</td>
                  <td className="px-4 py-3 text-right text-zinc-400">{p.avg_position > 0 ? p.avg_position.toFixed(1) : "—"}</td>
                  <td className="px-4 py-3 text-right text-zinc-300">{p.conversions}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center sm:p-16">
          <BarChart3 className="h-12 w-12 text-zinc-700 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-300 mb-1">No performance data yet</h3>
          <p className="text-sm text-zinc-500">Publish content and add performance data to track your growth.</p>
        </div>
      )}
    </div>
  );
}
