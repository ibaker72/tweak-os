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
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Dashboard</h1>
        <p className="text-sm text-zinc-400 mt-1">Cross-module overview of Tweak OS</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column - wider */}
        <div className="lg:col-span-2 space-y-6">
          {/* Outbound Pipeline */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
                <Users className="h-4 w-4 text-emerald-500" />
                Outbound Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-zinc-500">Total Leads</p>
                  <p className="text-2xl font-bold text-zinc-100">{leads?.total_leads ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Hot Leads (70+)</p>
                  <p className="text-2xl font-bold text-red-400">{leads?.leads_by_score_tier?.hot ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Contacted</p>
                  <p className="text-2xl font-bold text-zinc-100">{leads?.contacted_leads ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Avg Score</p>
                  <p className="text-2xl font-bold text-zinc-100">{leads?.average_score ?? 0}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <Link href="/leads" className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
                  View all leads →
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Inbound Pipeline */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
                <TrendingUp className="h-4 w-4 text-blue-500" />
                Inbound Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-zinc-500">Published</p>
                  <p className="text-2xl font-bold text-zinc-100">{growth?.total_published ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">In Pipeline</p>
                  <p className="text-2xl font-bold text-zinc-100">{growth?.pipeline_count ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Clicks (Month)</p>
                  <p className="text-2xl font-bold text-zinc-100">{growth?.total_clicks ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Conversions</p>
                  <p className="text-2xl font-bold text-emerald-400">{growth?.conversion_count ?? 0}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <Link href="/growth" className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
                  View growth engine →
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-zinc-400">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {activity.length > 0 ? (
                <div className="space-y-3">
                  {activity.slice(0, 10).map((item) => (
                    <div key={item.id} className="flex items-start gap-3">
                      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${item.module === "leads" ? "bg-emerald-500" : item.module === "growth" ? "bg-blue-500" : "bg-zinc-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-300">{item.action}</p>
                        <p className="text-xs text-zinc-500">{formatDate(item.created_at)}</p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
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

        {/* Right column - narrower */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-zinc-400">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/leads/discover" className="block">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Compass className="h-4 w-4" />
                  Find Leads
                </Button>
              </Link>
              <Link href="/growth/opportunities" className="block">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Search className="h-4 w-4" />
                  Find Opportunities
                </Button>
              </Link>
              <Link href="/growth/drafts/new" className="block">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <FileText className="h-4 w-4" />
                  New Draft
                </Button>
              </Link>
              <Link href="/leads/import" className="block">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Upload className="h-4 w-4" />
                  Import CSV
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* API Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-zinc-400">API Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
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
                  <span className="text-emerald-400 font-medium">${(leads?.api_usage?.google_places_cost ?? 0).toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
