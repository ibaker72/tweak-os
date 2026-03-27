"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  AlertTriangle,
  Flame,
  Mail,
  Phone,
  Linkedin,
  Clock,
  CheckCircle2,
  ChevronRight,
  CalendarClock,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LEAD_PRIORITIES } from "@/lib/shared/constants";

interface QueueLead {
  id: string;
  business_name: string;
  score: number;
  priority: string;
  next_action: string | null;
  next_action_date: string | null;
  lifecycle_status: string;
  city: string | null;
  state: string | null;
  website: string | null;
  niche?: string | null;
  tech_stack?: string[];
  contacted_at?: string | null;
}

interface DueSequence {
  id: string;
  lead_id: string;
  channel: string;
  sequence_step: number;
  subject: string | null;
  body: string | null;
  status: string;
  scheduled_for: string | null;
}

interface WorkQueueData {
  overdue_actions: QueueLead[];
  hot_leads: QueueLead[];
  overdue_followups: QueueLead[];
  due_sequences: DueSequence[];
}

export default function WorkQueuePage() {
  const [data, setData] = useState<WorkQueueData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leads/work-queue")
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleSnooze(leadId: string) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: leadId,
        next_action_date: tomorrow.toISOString().split("T")[0],
      }),
    });
    // Refresh
    const res = await fetch("/api/leads/work-queue");
    setData(await res.json());
  }

  async function handleMarkDone(leadId: string) {
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: leadId,
        next_action: null,
        next_action_date: null,
      }),
    });
    const res = await fetch("/api/leads/work-queue");
    setData(await res.json());
  }

  async function handleMarkSent(sequenceId: string) {
    await fetch("/api/outreach/sequences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sequenceId, status: "sent" }),
    });
    const res = await fetch("/api/leads/work-queue");
    setData(await res.json());
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  const totalTasks =
    (data?.overdue_actions.length ?? 0) +
    (data?.due_sequences.length ?? 0) +
    (data?.hot_leads.length ?? 0) +
    (data?.overdue_followups.length ?? 0);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-xl font-bold text-zinc-50 sm:text-2xl">
          Today&apos;s Work
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {totalTasks > 0
            ? `${totalTasks} items need your attention`
            : "You're all caught up!"}
        </p>
      </div>

      {/* Urgent: Overdue Actions */}
      {data?.overdue_actions && data.overdue_actions.length > 0 && (
        <Card className="border-red-500/20">
          <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-red-400">
              <AlertTriangle className="h-4 w-4" />
              Overdue Actions
              <Badge variant="destructive" className="ml-auto text-[10px]">
                {data.overdue_actions.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-2">
              {data.overdue_actions.map((lead) => {
                const daysOverdue = lead.next_action_date
                  ? Math.max(
                      0,
                      Math.floor(
                        (Date.now() -
                          new Date(lead.next_action_date).getTime()) /
                          (1000 * 60 * 60 * 24)
                      )
                    )
                  : 0;
                const priorityInfo = LEAD_PRIORITIES.find(
                  (p) => p.value === lead.priority
                );

                return (
                  <div
                    key={lead.id}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
                  >
                    <ScoreBadge score={lead.score} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="truncate text-sm font-medium text-zinc-100 hover:text-lime-400"
                        >
                          {lead.business_name}
                        </Link>
                        {priorityInfo && (
                          <span
                            className={`text-[10px] font-medium ${priorityInfo.color}`}
                          >
                            {priorityInfo.label}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-zinc-500">
                        {lead.next_action || "No action specified"}
                        {daysOverdue > 0 && (
                          <span className="ml-1 text-red-400">
                            ({daysOverdue}d overdue)
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkDone(lead.id)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Done
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSnooze(lead.id)}
                      >
                        <CalendarClock className="h-3.5 w-3.5" />
                        +1d
                      </Button>
                      <Link href={`/leads/${lead.id}`}>
                        <Button variant="ghost" size="icon">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Outreach Due */}
      {data?.due_sequences && data.due_sequences.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-blue-400">
              <Send className="h-4 w-4" />
              Outreach Due Today
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {data.due_sequences.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-2">
              {data.due_sequences.map((seq) => (
                <div
                  key={seq.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
                >
                  <ChannelIcon channel={seq.channel} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        Step {seq.sequence_step}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {seq.channel}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-400">
                      {seq.subject || (seq.body?.slice(0, 80) ?? "No content")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleMarkSent(seq.id)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark Sent
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hot Leads */}
      {data?.hot_leads && data.hot_leads.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-orange-400">
              <Flame className="h-4 w-4" />
              Hot Leads — Ready for Outreach
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {data.hot_leads.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-2">
              {data.hot_leads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/leads/${lead.id}`}
                  className="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700"
                >
                  <ScoreBadge score={lead.score} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-lime-400">
                      {lead.business_name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {[lead.city, lead.state].filter(Boolean).join(", ") ||
                        lead.niche ||
                        "—"}
                      {lead.tech_stack && lead.tech_stack.length > 0 && (
                        <span className="ml-2 text-zinc-600">
                          {lead.tech_stack[0]}
                        </span>
                      )}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overdue Follow-ups */}
      {data?.overdue_followups && data.overdue_followups.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-amber-400">
              <Clock className="h-4 w-4" />
              Overdue Follow-ups
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {data.overdue_followups.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-2">
              {data.overdue_followups.map((lead) => {
                const daysSince = lead.contacted_at
                  ? Math.floor(
                      (Date.now() -
                        new Date(lead.contacted_at).getTime()) /
                        (1000 * 60 * 60 * 24)
                    )
                  : 0;

                return (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700"
                  >
                    <ScoreBadge score={lead.score} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-lime-400">
                        {lead.business_name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Contacted {daysSince} days ago — no reply
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {totalTasks === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-10 w-10 text-lime-400" />
            <p className="mt-3 text-sm font-medium text-zinc-300">
              All caught up!
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              No tasks for today. Go discover some new leads.
            </p>
            <Link href="/leads/discover" className="mt-4">
              <Button size="sm">Find New Leads</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "text-red-400 bg-red-500/10"
      : score >= 40
        ? "text-orange-400 bg-orange-500/10"
        : "text-blue-400 bg-blue-500/10";

  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${color}`}
    >
      {score}
    </span>
  );
}

function ChannelIcon({ channel }: { channel: string }) {
  const iconClass = "h-4 w-4 text-zinc-400";
  switch (channel) {
    case "email":
      return <Mail className={iconClass} />;
    case "linkedin":
      return <Linkedin className={iconClass} />;
    case "phone":
      return <Phone className={iconClass} />;
    default:
      return <Mail className={iconClass} />;
  }
}
