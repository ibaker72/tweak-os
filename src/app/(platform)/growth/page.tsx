"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Eye,
  MousePointerClick,
  Target,
  Edit,
  UserCheck,
  Search,
  Plus,
  AlertTriangle,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type {
  GrowthDashboardStats,
  GrowthDraft,
  GrowthCalendarEntry,
} from "@/types/growth";

interface NeedsAttention {
  stale_drafts: { id: string; title: string; updated_at: string }[];
  overdue_scheduled: { id: string; title: string; scheduled_for: string }[];
}

const metricCards = [
  { key: "total_published" as const, label: "Published", icon: FileText, color: "text-emerald-500" },
  { key: "total_impressions" as const, label: "Impressions", icon: Eye, color: "text-blue-500" },
  { key: "total_clicks" as const, label: "Clicks", icon: MousePointerClick, color: "text-violet-500" },
  { key: "avg_position" as const, label: "Avg Position", icon: Target, color: "text-amber-500" },
  { key: "pipeline_count" as const, label: "Pipeline", icon: Edit, color: "text-cyan-500" },
  { key: "conversion_count" as const, label: "Conversions", icon: UserCheck, color: "text-emerald-500" },
];

export default function GrowthDashboardPage() {
  const [stats, setStats] = useState<GrowthDashboardStats | null>(null);
  const [attention, setAttention] = useState<NeedsAttention | null>(null);
  const [recentPublished, setRecentPublished] = useState<GrowthDraft[]>([]);
  const [upcoming, setUpcoming] = useState<GrowthCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);

      const [statsRes, publishedRes, upcomingRes] = await Promise.all([
        fetch("/api/growth/analytics").catch(() => null),
        fetch("/api/growth/drafts?status=published&limit=5").catch(() => null),
        fetch("/api/growth/calendar?limit=5&upcoming=true").catch(() => null),
      ]);

      // Stats — API returns { performance, stats }
      if (statsRes?.ok) {
        const data = await statsRes.json();
        const s = data?.stats ?? null;
        if (s) {
          setStats({
            total_published: Number(s.total_published) || 0,
            total_impressions: Number(s.total_impressions) || 0,
            total_clicks: Number(s.total_clicks) || 0,
            avg_position: Number(s.avg_position) || 0,
            pipeline_count: Number(s.pipeline_count) || 0,
            conversion_count: Number(s.conversion_count) || 0,
          });
        }

        // Build needs-attention from stale/overdue drafts
        if (data?.needs_attention) {
          setAttention({
            stale_drafts: Array.isArray(data.needs_attention.stale_drafts)
              ? data.needs_attention.stale_drafts
              : [],
            overdue_scheduled: Array.isArray(data.needs_attention.overdue_scheduled)
              ? data.needs_attention.overdue_scheduled
              : [],
          });
        }
      }

      // Published drafts
      if (publishedRes?.ok) {
        const data = await publishedRes.json();
        const drafts = Array.isArray(data) ? data : Array.isArray(data?.drafts) ? data.drafts : [];
        setRecentPublished(drafts);
      }

      // Upcoming calendar
      if (upcomingRes?.ok) {
        const data = await upcomingRes.json();
        const entries = Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : [];
        setUpcoming(entries);
      }
    } catch (err) {
      setError("Failed to load dashboard data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function formatMetricValue(key: string, value: unknown): string {
    const num = Number(value);
    if (isNaN(num)) return "0";
    if (key === "avg_position") return num > 0 ? num.toFixed(1) : "—";
    if (key === "total_impressions" || key === "total_clicks") {
      return num >= 1000 ? `${(num / 1000).toFixed(1)}k` : String(num);
    }
    return String(num);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500 px-4">
        <AlertTriangle className="h-8 w-8 mb-3" />
        <p className="text-center">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  const staleDrafts = attention?.stale_drafts ?? [];
  const overdueDrafts = attention?.overdue_scheduled ?? [];
  const hasAttentionItems = staleDrafts.length > 0 || overdueDrafts.length > 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-50">Growth Engine</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Content pipeline and SEO performance
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/growth/opportunities" className="flex-1 sm:flex-none">
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Find </span>Opportunities
            </Button>
          </Link>
          <Link href="/growth/drafts/new" className="flex-1 sm:flex-none">
            <Button size="sm" className="w-full sm:w-auto">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New </span>Draft
            </Button>
          </Link>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 sm:gap-4">
        {metricCards.map(({ key, label, icon: Icon, color }) => (
          <div
            key={key}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5 transition-colors hover:border-zinc-700"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs sm:text-sm text-zinc-400 truncate pr-2">{label}</p>
              <div className="rounded-lg bg-zinc-800 p-1.5 sm:p-2 shrink-0">
                <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${color}`} />
              </div>
            </div>
            <p className="mt-2 text-2xl sm:text-3xl font-bold text-zinc-50">
              {stats ? formatMetricValue(key, stats[key]) : "—"}
            </p>
          </div>
        ))}
      </div>

      {/* Dashboard Sections */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Needs Attention */}
        <Card className="md:col-span-2 lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Needs Attention
              {hasAttentionItems && (
                <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
                  {staleDrafts.length + overdueDrafts.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasAttentionItems ? (
              <div className="space-y-1">
                {staleDrafts.map((item) => (
                  <Link
                    key={item.id}
                    href={`/growth/drafts/${item.id}`}
                    className="flex items-start gap-3 rounded-lg p-2.5 -mx-1 hover:bg-zinc-800/50 transition-colors group"
                  >
                    <Edit className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 truncate group-hover:text-zinc-100">
                        {item.title || "Untitled draft"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Stale since {formatDate(item.updated_at)}
                      </p>
                    </div>
                  </Link>
                ))}
                {overdueDrafts.map((item) => (
                  <Link
                    key={item.id}
                    href={`/growth/drafts/${item.id}`}
                    className="flex items-start gap-3 rounded-lg p-2.5 -mx-1 hover:bg-zinc-800/50 transition-colors group"
                  >
                    <Clock className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 truncate group-hover:text-zinc-100">
                        {item.title || "Untitled draft"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Overdue: {formatDate(item.scheduled_for)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <div className="rounded-full bg-emerald-500/10 p-3 mb-3">
                  <AlertTriangle className="h-5 w-5 text-emerald-500" />
                </div>
                <p className="text-sm text-zinc-400">Everything looks good</p>
                <p className="text-xs text-zinc-600 mt-1">No stale or overdue content</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recently Published */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <FileText className="h-4 w-4 text-emerald-500" />
              Recently Published
              {recentPublished.length > 0 && (
                <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
                  {recentPublished.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentPublished.length > 0 ? (
              <div className="space-y-1">
                {recentPublished.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex items-start justify-between gap-3 rounded-lg p-2.5 -mx-1 hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 truncate">
                        {draft.title || "Untitled"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatDate(draft.published_at)}
                      </p>
                    </div>
                    {draft.published_url && (
                      <a
                        href={draft.published_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-emerald-500 hover:text-emerald-400 p-1"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <div className="rounded-full bg-zinc-800 p-3 mb-3">
                  <FileText className="h-5 w-5 text-zinc-600" />
                </div>
                <p className="text-sm text-zinc-400">No published content yet</p>
                <p className="text-xs text-zinc-600 mt-1">Create and publish your first article</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <Clock className="h-4 w-4 text-blue-500" />
              Upcoming
              {upcoming.length > 0 && (
                <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
                  {upcoming.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length > 0 ? (
              <div className="space-y-1">
                {upcoming.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-3 rounded-lg p-2.5 -mx-1 hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 truncate">
                        {entry.title || "Untitled"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className="text-xs text-zinc-500">
                          {formatDate(entry.scheduled_date)}
                        </p>
                        {entry.content_type && (
                          <Badge variant="secondary" className="text-[10px]">
                            {entry.content_type.replace("_", " ")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <div className="rounded-full bg-zinc-800 p-3 mb-3">
                  <Clock className="h-5 w-5 text-zinc-600" />
                </div>
                <p className="text-sm text-zinc-400">Nothing scheduled</p>
                <p className="text-xs text-zinc-600 mt-1">
                  <Link href="/growth/calendar" className="text-emerald-500 hover:text-emerald-400">
                    Open calendar
                  </Link>
                  {" "}to plan content
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {[
          { href: "/growth/pipeline", label: "Pipeline", icon: Edit, desc: "Track content stages" },
          { href: "/growth/analytics", label: "Analytics", icon: Eye, desc: "Performance data" },
          { href: "/growth/calendar", label: "Calendar", icon: Clock, desc: "Content schedule" },
          { href: "/growth/publish-queue", label: "Publish Queue", icon: FileText, desc: "Ready to go live" },
        ].map((link) => (
          <Link key={link.href} href={link.href}>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 hover:bg-zinc-800/50 transition-all group cursor-pointer h-full">
              <link.icon className="h-5 w-5 text-zinc-500 group-hover:text-emerald-500 transition-colors mb-2" />
              <p className="text-sm font-medium text-zinc-200">{link.label}</p>
              <p className="text-xs text-zinc-500 mt-0.5 hidden sm:block">{link.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
