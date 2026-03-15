"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users, TrendingUp, Search, FileText, Plus, Upload,
  Compass, Loader2, ExternalLink, Calendar,
  BarChart3, Flame, Eye, MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface DashboardData {
  leads: {
    total_leads: number;
    enriched_leads: number;
    contacted_leads: number;
    average_score: number;
    leads_this_week: number;
    leads_by_score_tier: { hot: number; warm: number; cold: number };
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shared/stats")
      .then((r) => r.json())
      .then(setData)
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

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">Cross-module overview of Tweak OS</p>
      </div>

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
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
                <MetricBlock label="Total Leads" value={leads?.total_leads ?? 0} />
                <MetricBlock label="Hot Leads (70+)" value={leads?.leads_by_score_tier?.hot ?? 0} valueClass="text-red-400" />
                <MetricBlock label="Contacted" value={leads?.contacted_leads ?? 0} />
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

          {/* API Usage */}
          <Card>
            <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
              <CardTitle className="text-sm font-medium text-zinc-400">API Usage</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs text-zinc-400">
                    <span>Google Places (today)</span>
                    <span>{leads?.api_usage?.google_places_today ?? 0}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.min(((leads?.api_usage?.google_places_today ?? 0) / 10000) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>Google Search (today)</span>
                  <span>{leads?.api_usage?.google_search_today ?? 0} / 100</span>
                </div>
                <div className="flex justify-between text-xs text-zinc-400">
                  <span>OpenAI (month)</span>
                  <span>{leads?.api_usage?.openai_this_month ?? 0} calls</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">Est. Google Cost</span>
                  <span className="font-medium text-emerald-400">${(leads?.api_usage?.google_places_cost ?? 0).toFixed(2)}</span>
                </div>
              </div>
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
