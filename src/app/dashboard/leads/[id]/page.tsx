import { createClient } from "@/lib/supabase/server";
import { getLeadById, getActivityLog } from "@/lib/leads/queries";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { LeadDetailCard } from "@/components/dashboard/lead-detail-card";
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

  return (
    <div className="space-y-6">
      <DashboardHeader
        title={lead.business_name}
        description={lead.website ?? undefined}
      >
        <Link href="/dashboard/leads">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Back to Leads
          </Button>
        </Link>
      </DashboardHeader>

      <LeadDetailCard lead={lead} activityLog={activityLog} />
    </div>
  );
}
