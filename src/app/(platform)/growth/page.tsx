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
  { key: "total_published" as const, label: "Total Published", icon: FileText },
  { key: "total_impressions" as const, label: "Total Impressions", icon: Eye },
  { key: "total_clicks" as const, label: "Total Clicks", icon: MousePointerClick },
  { key: "avg_position" as const, label: "Avg Position", icon: Target },
  { key: "pipeline_count" as const, label: "Pipeline", icon: Edit },
  { key: "conversion_count" as const, label: "Conversions", icon: UserCheck },
];

export default function GrowthDashboardPage() {
  const [stats, setStats] = useState<GrowthDashboardStats | null>(null);
  const [attention, setAttention] = useState<NeedsAttention | null>(null);
  const [recentPublished, setRecentPublished] = useState<GrowthDraft[]>([]);
  const [upcoming, setUpcoming] = useState<GrowthCalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [statsRes, attentionRes, publishedRes, upcomingRes] =
          await Promise.all([
            fetch("/api/growth/analytics"),
            fetch("/api/growth/analytics?needs_attention=true"),
            fetch("/api/growth/drafts?status=published&limit=5"),
            fetch("/api/growth/calendar?limit=5&upcoming=true"),
          ]);

        if (statsRes.ok) {
          setStats(await statsRes.json());
        }
        if (attentionRes.ok) {
          const data = await attentionRes.json();
          setAttention(data.needs_attention ?? data);
        }
        if (publishedRes.ok) {
          const data = await publishedRes.json();
          setRecentPublished(Array.isArray(data) ? data : data.drafts ?? []);
        }
        if (upcomingRes.ok) {
          const data = await upcomingRes.json();
          setUpcoming(Array.isArray(data) ? data : data.entries ?? []);
        }
      } catch (err) {
        setError("Failed to load dashboard data");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  function formatMetricValue(key: string, value: number): string {
    if (key === "avg_position") return value.toFixed(1);
    if (key === "total_impressions" || key === "total_clicks") {
      return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
    }
    return String(value);
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
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <AlertTriangle className="h-8 w-8 mb-2" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Growth Engine</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Content pipeline and SEO performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/growth/opportunities">
            <Button variant="outline" size="sm">
              <Search className="h-4 w-4" />
              Find Opportunities
            </Button>
          </Link>
          <Link href="/growth/drafts/new">
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4" />
              Create Brief
            </Button>
          </Link>
          <Link href="/growth/drafts/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New Draft
            </Button>
          </Link>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {metricCards.map(({ key, label, icon: Icon }) => (
          <div
            key={key}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-6"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">{label}</p>
              <div className="rounded-lg bg-emerald-500/10 p-2">
                <Icon className="h-4 w-4 text-emerald-500" />
              </div>
            </div>
            <p className="mt-2 text-3xl font-bold text-zinc-50">
              {stats ? formatMetricValue(key, stats[key]) : "--"}
            </p>
          </div>
        ))}
      </div>

      {/* Three sections */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Needs Attention */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Needs Attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attention &&
            (attention.stale_drafts?.length > 0 ||
              attention.overdue_scheduled?.length > 0) ? (
              <div className="space-y-3">
                {attention.stale_drafts?.map((item) => (
                  <Link
                    key={item.id}
                    href={`/growth/drafts/${item.id}`}
                    className="flex items-start gap-2 rounded-lg p-2 hover:bg-zinc-800/50 transition-colors"
                  >
                    <Edit className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm text-zinc-200">{item.title}</p>
                      <p className="text-xs text-zinc-500">
                        Stale since {formatDate(item.updated_at)}
                      </p>
                    </div>
                  </Link>
                ))}
                {attention.overdue_scheduled?.map((item) => (
                  <Link
                    key={item.id}
                    href={`/growth/drafts/${item.id}`}
                    className="flex items-start gap-2 rounded-lg p-2 hover:bg-zinc-800/50 transition-colors"
                  >
                    <Clock className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm text-zinc-200">{item.title}</p>
                      <p className="text-xs text-zinc-500">
                        Overdue: {formatDate(item.scheduled_for)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                Everything looks good
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recently Published */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <FileText className="h-4 w-4 text-emerald-500" />
              Recently Published
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentPublished.length > 0 ? (
              <div className="space-y-3">
                {recentPublished.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200 truncate">
                        {draft.title}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {draft.published_at
                          ? formatDate(draft.published_at)
                          : "--"}
                      </p>
                    </div>
                    {draft.published_url && (
                      <a
                        href={draft.published_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-emerald-500 hover:text-emerald-400"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No published content yet</p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <Clock className="h-4 w-4 text-blue-500" />
              Upcoming
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcoming.length > 0 ? (
              <div className="space-y-3">
                {upcoming.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200 truncate">
                        {entry.title}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
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
              <p className="text-sm text-zinc-500">Nothing scheduled</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
