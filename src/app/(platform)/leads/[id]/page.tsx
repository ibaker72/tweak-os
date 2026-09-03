import { createClient } from "@/lib/supabase/server";
import { getLeadById, getActivityLog } from "@/lib/leads/queries";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { LeadDetailCard } from "@/components/dashboard/lead-detail-card";
import { LeadDetailExtras } from "@/components/dashboard/lead-detail-extras";
import { SmsPanel } from "@/components/dashboard/sms-panel";
import { VoiceCallPanel } from "@/components/dashboard/voice-call-panel";
import { ConvertToAccount } from "@/components/leads/convert-to-account";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSmsMessagesForLead } from "@/lib/sms/queries";
import { isSmsSendingEnabled } from "@/lib/sms/config";
import { getVoiceCallsForLead } from "@/lib/voice/queries";
import { isVoiceEnabled } from "@/lib/voice/config";
import { getCallbackPhone } from "@/lib/voice/callback-phone";
import type { SmsMessage, VoiceCall } from "@/lib/leads/types";

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

  // Fetch agents for assignment dropdown
  let agents: { id: string; display_name: string }[] = [];
  try {
    const { data } = await supabase
      .from("agent_directory")
      .select("id, display_name")
      .eq("is_active", true)
      .order("display_name");
    agents = data ?? [];
  } catch {
    agents = [];
  }

  // Has this lead already been converted? RLS scopes accounts to the caller,
  // so an agent only sees an account they own.
  let converted: { accountId: string; dealId: string | null } | null = null;
  try {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("lead_id", id)
      .limit(1)
      .maybeSingle();
    if (account) {
      const { data: deal } = await supabase
        .from("deals")
        .select("id")
        .eq("account_id", account.id)
        .limit(1)
        .maybeSingle();
      converted = { accountId: account.id, dealId: deal?.id ?? null };
    }
  } catch {
    converted = null;
  }

  let smsMessages: SmsMessage[] = [];
  try {
    smsMessages = await getSmsMessagesForLead(supabase, id, 25);
  } catch {
    smsMessages = [];
  }

  // Click-to-call context. voice_calls RLS already scopes these to the caller,
  // so no assigned_to filter is needed here.
  let voiceCalls: VoiceCall[] = [];
  try {
    voiceCalls = await getVoiceCallsForLead(supabase, id, 8);
  } catch {
    voiceCalls = [];
  }

  // The agent's own callback number — the phone Twilio rings first. Read
  // through the shared accessor so this page and the Settings field can never
  // end up looking at different columns; agent_profiles RLS restricts a
  // non-admin to their own row, and the user_id filter is what keeps an admin
  // reading their own rather than a teammate's.
  let agentVoicePhone: string | null = null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      agentVoicePhone = await getCallbackPhone(supabase, { userId: user.id });
    }
  } catch {
    agentVoicePhone = null;
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

      <ConvertToAccount
        leadId={lead.id}
        businessName={lead.business_name}
        alreadyConverted={converted}
      />

      <VoiceCallPanel
        lead={lead}
        calls={voiceCalls}
        voiceEnabled={isVoiceEnabled()}
        agentVoicePhone={agentVoicePhone}
      />

      <SmsPanel
        lead={lead}
        messages={smsMessages}
        sendingEnabled={isSmsSendingEnabled()}
      />

      <LeadDetailExtras lead={lead} agents={agents} />
    </div>
  );
}
