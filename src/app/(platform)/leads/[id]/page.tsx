import { createClient } from "@/lib/supabase/server";
import { getLeadById, getActivityLog } from "@/lib/leads/queries";
import { getLatestAuditForLead } from "@/lib/audits/queries";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { LeadDetailCard } from "@/components/dashboard/lead-detail-card";
import { LeadDetailExtras } from "@/components/dashboard/lead-detail-extras";
import { LeadAuditTab } from "@/components/audit/LeadAuditTab";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const lead = await getLeadById(supabase, id);

  if (!lead) {
    notFound();
  }

  let activityLog: Awaited<ReturnType<typeof getActivityLog>> = [];
  try {
    activityLog = await getActivityLog(supabase, id);
  } catch {
    activityLog = [];
  }

  let latestAudit: Awaited<ReturnType<typeof getLatestAuditForLead>> = null;
  try {
    latestAudit = await getLatestAuditForLead(supabase, id, lead.website);
  } catch {
    latestAudit = null;
  }

  // Fetch agents for assignment dropdown
  let agents: { id: string; display_name: string }[] = [];
  try {
    const { data } = await supabase
      .from("agent_profiles")
      .select("id, display_name")
      .eq("is_active", true)
      .order("display_name");
    agents = data ?? [];
  } catch {
    agents = [];
  }

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <DashboardHeader
        title={lead.business_name}
        description={lead.website ?? undefined}
      >
        <Link href="/leads" className="w-full sm:w-auto">
          <Button variant="outline" size="sm" className="w-full sm:w-auto">
            <ArrowLeft className="h-4 w-4" />
            Back to Leads
          </Button>
        </Link>
      </DashboardHeader>

      <LeadDetailCard lead={lead} activityLog={activityLog} />

      <LeadAuditTab
        leadId={lead.id}
        website={lead.website}
        audit={latestAudit}
      />

      <LeadDetailExtras lead={lead} agents={agents} />
    </div>
  );
}
