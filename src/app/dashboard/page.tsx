import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/leads/queries";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  CheckCircle,
  PhoneCall,
  AlertTriangle,
  BarChart3,
  TrendingUp,
  Flame,
  Calendar,
  DollarSign,
} from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const stats = await getDashboardStats(supabase);

  return (
    <div className="space-y-8">
      <DashboardHeader
        title="Dashboard"
        description="Overview of your lead pipeline"
      >
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>Google Places: {stats.api_usage.google_places_today} calls today</span>
          <span>|</span>
          <span>Est. cost: ${stats.api_usage.google_places_cost.toFixed(2)}/mo</span>
        </div>
      </DashboardHeader>

      {/* Top-level stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Total Leads"
          value={stats.total_leads}
          icon={Users}
        />
        <StatCard
          title="Enriched"
          value={stats.enriched_leads}
          icon={CheckCircle}
        />
        <StatCard
          title="Contacted"
          value={stats.contacted_leads}
          icon={PhoneCall}
        />
        <StatCard
          title="Avg Score"
          value={stats.average_score}
          icon={BarChart3}
        />
        <StatCard
          title="This Week"
          value={stats.leads_this_week}
          icon={TrendingUp}
        />
      </div>

      {/* Second row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Score Tiers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <Flame className="h-4 w-4" />
              Leads by Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="text-sm text-zinc-300">Hot (70+)</span>
                </div>
                <span className="text-sm font-bold text-red-400">
                  {stats.leads_by_score_tier.hot}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-orange-500" />
                  <span className="text-sm text-zinc-300">Warm (40-69)</span>
                </div>
                <span className="text-sm font-bold text-orange-400">
                  {stats.leads_by_score_tier.warm}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-blue-500" />
                  <span className="text-sm text-zinc-300">Cold (0-39)</span>
                </div>
                <span className="text-sm font-bold text-blue-400">
                  {stats.leads_by_score_tier.cold}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <Calendar className="h-4 w-4" />
              Pipeline Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(stats.leads_by_status).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm capitalize text-zinc-400">
                    {status.replace("_", " ")}
                  </span>
                  <span className="text-sm font-medium text-zinc-200">
                    {count}
                  </span>
                </div>
              ))}
              {Object.keys(stats.leads_by_status).length === 0 && (
                <p className="text-sm text-zinc-500">No leads yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Industries */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
              <DollarSign className="h-4 w-4" />
              Top Industries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.top_industries.slice(0, 7).map(({ industry, count }) => (
                <div key={industry} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400 truncate max-w-[180px]">
                    {industry}
                  </span>
                  <span className="text-sm font-medium text-zinc-200">
                    {count}
                  </span>
                </div>
              ))}
              {stats.top_industries.length === 0 && (
                <p className="text-sm text-zinc-500">No data yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* API Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-zinc-400">
            API Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-zinc-500">Google Places (today)</p>
              <p className="text-lg font-bold text-zinc-200">
                {stats.api_usage.google_places_today}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Google Search (today)</p>
              <p className="text-lg font-bold text-zinc-200">
                {stats.api_usage.google_search_today}
                <span className="text-xs font-normal text-zinc-500"> / 100</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">OpenAI (this month)</p>
              <p className="text-lg font-bold text-zinc-200">
                {stats.api_usage.openai_this_month}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Est. Google Cost (month)</p>
              <p className="text-lg font-bold text-emerald-400">
                ${stats.api_usage.google_places_cost.toFixed(2)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
