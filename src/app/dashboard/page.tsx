import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/leads/queries";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { Users, CheckCircle, PhoneCall, AlertTriangle, BarChart3 } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const stats = await getDashboardStats(supabase);

  return (
    <div className="space-y-8">
      <DashboardHeader
        title="Dashboard"
        description="Overview of your lead pipeline"
      />

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
          title="Failed Jobs"
          value={stats.failed_jobs}
          icon={AlertTriangle}
        />
        <StatCard
          title="Avg Score"
          value={stats.average_score}
          icon={BarChart3}
        />
      </div>
    </div>
  );
}
