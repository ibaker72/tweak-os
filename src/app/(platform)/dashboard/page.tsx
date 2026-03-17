"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users, TrendingUp, Search, FileText, Plus, Upload,
  Compass, Loader2, ExternalLink, Calendar,
  BarChart3, Flame, Eye, MousePointerClick,
  AlertCircle, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface ActionItem {
  id: string;
  label: string;
  href: string;
  priority: "high" | "medium" | "low";
  count: number;
}

interface RecentLead {
  id: string;
  business_name: string;
  score: number;
  city: string | null;
  state: string | null;
}

interface DashboardData {
  leads: {
    total_leads: number;
    enriched_leads: number;
    contacted_leads: number;
    replied_leads: number;
    booked_leads: number;
    average_score: number;
    leads_this_week: number;
    leads_by_score_tier: { hot: number; warm: number; cold: number };
    recent_leads: RecentLead[];
    api_usage: {
      google_places_today: number;
      google_search_today: number;
      openai_this_month: number;
      google_places_cost: number;
    };
  };
  growth: {
    total_published: number;
    total_impressions: number;
    total_clicks: number;
    avg_position: number;
    pipeline_count: number;
    conversion_count: number;
  };
  recent_activity: {
    id: string;
    module: string;
    action: string;
    entity_type: string | null;
    created_at: string;
  }[];
}

export default function UnifiedDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/shared/stats").then((r) => r.json()),
      fetch("/api/shared/action-items").then((r) => r.json()).catch(() => ({ items: [] })),
    ])
      .then(([statsData, actionData]) => {
        setData(statsData);
        setActionItems(actionData.items ?? []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  const leads = data?.leads;
  const growth = data?.growth;
  const activity = data?.recent_activity ?? [];
  const recentLeads = leads?.recent_leads ?? [];

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">Cross-module overview of Tweak OS</p>
      </div>

      {/* Action Items */}
      <Card>
        <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            Action Items
            {actionItems.length > 0 && (
              <Badge variant="secondary" className="ml-auto text-[10px] tabular-nums">
                {actionItems.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          {actionItems.length > 0 ? (
            <div className="space-y-1">
              {actionItems.slice(0, 8).map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="group -mx-1 flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-zinc-800/50"
                >
                  <div
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      item.priority === "high"
                        ? "bg-red-500"
                        : item.priority === "medium"
                          ? "bg-amber-500"
                          : "bg-blue-500"
                    }`}
                  />
                  <span className="text-sm text-zinc-300 group-hover:text-zinc-100">
                    {item.label}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <span className="text-sm text-zinc-400">You&apos;re all caught up</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main grid: stacked on mobile, 3-col on lg */}
      <div className="grid gap-5 sm:gap-6 lg:grid-cols-3">
        {/* Left column - wider */}
        <div className="space-y-5 sm:space-y-6 lg:col-span-2">
          {/* Outbound Pipeline */}
          <Card>
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
                <Users className="h-4 w-4 text-emerald-500" />
                Outbound Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
                <MetricBlock label="Total" value={leads?.total_leads ?? 0} />
                <MetricBlock label="Hot (70+)" value={leads?.leads_by_score_tier?.hot ?? 0} valueClass="text-red-400" />
                <MetricBlock label="Contacted" value={leads?.contacted_leads ?? 0} />
                <MetricBlock label="Replied" value={leads?.replied_leads ?? 0} valueClass="text-blue-400" />
                <MetricBlock label="Booked" value={leads?.booked_leads ?? 0} valueClass="text-emerald-400" />
                <MetricBlock label="Avg Score" value={leads?.average_score ?? 0} />
              </div>
              <div className="mt-4 border-t border-zinc-800 pt-4">
                <Link href="/leads" className="text-sm text-emerald-400 transition-colors hover:text-emerald-300">
                  View all leads →
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Inbound Pipeline */}
          <Card>
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
                <TrendingUp className="h-4 w-4 text-blue-500" />
                Inbound Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
                <MetricBlock label="Published" value={growth?.total_published ?? 0} />
                <MetricBlock label="In Pipeline" value={growth?.pipeline_count ?? 0} />
                <MetricBlock label="Clicks (Month)" value={growth?.total_clicks ?? 0} />
                <MetricBlock label="Conversions" value={growth?.conversion_count ?? 0} valueClass="text-emerald-400" />
              </div>
              <div className="mt-4 border-t border-zinc-800 pt-4">
                <Link href="/growth" className="text-sm text-emerald-400 transition-colors hover:text-emerald-300">
                  View growth engine →
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card>
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="text-sm font-medium text-zinc-400">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {activity.length > 0 ? (
                <div className="space-y-3">
                  {activity.slice(0, 10).map((item) => (
                    <div key={item.id} className="flex items-start gap-3">
                      <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.module === "leads" ? "bg-emerald-500" : item.module === "growth" ? "bg-blue-500" : "bg-zinc-500"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-300">{item.action}</p>
                        <p className="text-xs text-zinc-500">{formatDate(item.created_at)}</p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {item.module}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No recent activity</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column - narrower: stacks below the left column on mobile */}
        <div className="space-y-5 sm:space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="text-sm font-medium text-zinc-400">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 sm:gap-2">
                <Link href="/leads/discover">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Compass className="h-4 w-4" />
                    Find Leads
                  </Button>
                </Link>
                <Link href="/growth/opportunities">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Search className="h-4 w-4" />
                    <span className="hidden sm:inline">Find </span>Opportunities
                  </Button>
                </Link>
                <Link href="/growth/drafts/new">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <FileText className="h-4 w-4" />
                    New Draft
                  </Button>
                </Link>
                <Link href="/leads/import">
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <Upload className="h-4 w-4" />
                    Import CSV
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Latest Leads */}
          <Card>
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="text-sm font-medium text-zinc-400">Latest Leads</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {recentLeads.length > 0 ? (
                <div className="space-y-1">
                  {recentLeads.map((lead) => (
                    <Link
                      key={lead.id}
                      href={`/leads/${lead.id}`}
                      className="group -mx-1 flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-zinc-800/50"
                    >
                      <div
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          lead.score >= 70
                            ? "bg-red-500"
                            : lead.score >= 40
                              ? "bg-amber-500"
                              : "bg-zinc-500"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-200 group-hover:text-zinc-100">
                          {lead.business_name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {[lead.city, lead.state].filter(Boolean).join(", ") || "—"}
                        </p>
                      </div>
                    </Link>
                  ))}
                  <div className="pt-2 border-t border-zinc-800">
                    <Link
                      href="/leads"
                      className="text-sm text-emerald-400 transition-colors hover:text-emerald-300"
                    >
                      View all →
                    </Link>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">No leads yet. Discover or import leads to get started.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Small inline metric block used in pipeline cards */
function MetricBlock({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: number;
  valueClass?: string;
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-bold sm:text-2xl ${valueClass ?? "text-zinc-100"}`}>{value}</p>
    </div>
  );
}
