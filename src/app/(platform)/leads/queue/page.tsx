"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Select } from "@/components/ui/select";
import { LEAD_PRIORITIES } from "@/lib/shared/constants";
import { LeadActionMenu } from "@/components/leads/lead-action-menu";

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
  hot_leads_total: number;
  overdue_followups: QueueLead[];
  due_sequences: DueSequence[];
  limit: number;
}

const QUEUE_LIMITS = [10, 25, 50, 100] as const;
const DEFAULT_LIMIT = 50;
const STORAGE_KEY = "tweak.queue_limit";

function readStoredLimit(): number {
  if (typeof window === "undefined") return DEFAULT_LIMIT;
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("queue_limit");
  if (fromUrl) {
    const n = parseInt(fromUrl, 10);
    if ((QUEUE_LIMITS as readonly number[]).includes(n)) return n;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const n = parseInt(stored, 10);
    if ((QUEUE_LIMITS as readonly number[]).includes(n)) return n;
  }
  return DEFAULT_LIMIT;
}

export default function WorkQueuePage() {
  const [data, setData] = useState<WorkQueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState<number>(DEFAULT_LIMIT);
  // Track ids the user has acted on so we can hide them instantly.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  // Initialize limit on the client only — avoids SSR/CSR mismatch.
  useEffect(() => {
    setLimit(readStoredLimit());
  }, []);

  const fetchQueue = useCallback(
    async (l: number) => {
      try {
        const res = await fetch(`/api/leads/work-queue?limit=${l}`);
        const json = (await res.json()) as WorkQueueData;
        setData(json);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchQueue(limit);
  }, [fetchQueue, limit]);

  function updateLimit(next: number) {
    setLimit(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(next));
      const url = new URL(window.location.href);
      url.searchParams.set("queue_limit", String(next));
      window.history.replaceState({}, "", url.toString());
    }
  }

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
    fetchQueue(limit);
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
    fetchQueue(limit);
  }

  async function handleMarkSent(sequenceId: string) {
    await fetch("/api/outreach/sequences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sequenceId, status: "sent" }),
    });
    fetchQueue(limit);
  }

  const handleActionComplete = useCallback((leadId: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(leadId);
      return next;
    });
  }, []);

  const visibleHotLeads = useMemo(
    () => (data?.hot_leads ?? []).filter((l) => !hiddenIds.has(l.id)),
    [data?.hot_leads, hiddenIds]
  );
  const visibleOverdueActions = useMemo(
    () => (data?.overdue_actions ?? []).filter((l) => !hiddenIds.has(l.id)),
    [data?.overdue_actions, hiddenIds]
  );
  const visibleOverdueFollowups = useMemo(
    () => (data?.overdue_followups ?? []).filter((l) => !hiddenIds.has(l.id)),
    [data?.overdue_followups, hiddenIds]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  // Subtract hidden ids so the count reflects what's actually showing.
  const hotTotal = Math.max(
    0,
    (data?.hot_leads_total ?? data?.hot_leads.length ?? 0) -
      ((data?.hot_leads ?? []).length - visibleHotLeads.length)
  );

  const totalTasks =
    visibleOverdueActions.length +
    (data?.due_sequences.length ?? 0) +
    hotTotal +
    visibleOverdueFollowups.length;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <label htmlFor="queue-limit" className="shrink-0">
            Show
          </label>
          <Select
            id="queue-limit"
            value={String(limit)}
            onChange={(e) => updateLimit(Number(e.target.value))}
            className="h-8 w-24 text-xs"
          >
            {QUEUE_LIMITS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <span className="shrink-0">per list</span>
        </div>
      </div>

      {/* Urgent: Overdue Actions */}
      {visibleOverdueActions.length > 0 && (
        <Card className="border-red-500/20">
          <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-red-400">
              <AlertTriangle className="h-4 w-4" />
              Overdue Actions
              <Badge variant="destructive" className="ml-auto text-[10px]">
                {visibleOverdueActions.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-2">
              {visibleOverdueActions.map((lead) => {
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
                      <LeadActionMenu
                        leadId={lead.id}
                        hasWebsite={!!lead.website}
                        alreadyContacted={lead.lifecycle_status === "contacted"}
                        onActionComplete={() =>
                          handleActionComplete(lead.id)
                        }
                      />
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
                  <Button size="sm" onClick={() => handleMarkSent(seq.id)}>
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
      <Card>
        <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-orange-400">
            <Flame className="h-4 w-4" />
            Hot Leads — Ready for Outreach
            <span className="ml-auto flex items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px]">
                {visibleHotLeads.length} shown
              </Badge>
              {hotTotal > visibleHotLeads.length && (
                <Badge variant="outline" className="text-[10px]">
                  {hotTotal} total
                </Badge>
              )}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          {visibleHotLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Flame className="h-8 w-8 text-zinc-700" />
              <p className="mt-3 text-sm font-medium text-zinc-300">
                No hot leads in the queue.
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Import or enrich leads to fill today&apos;s work queue.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleHotLeads.map((lead) => (
                <HotLeadRow
                  key={lead.id}
                  lead={lead}
                  onActionComplete={() => handleActionComplete(lead.id)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overdue Follow-ups */}
      {visibleOverdueFollowups.length > 0 && (
        <Card>
          <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-amber-400">
              <Clock className="h-4 w-4" />
              Overdue Follow-ups
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {visibleOverdueFollowups.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="space-y-2">
              {visibleOverdueFollowups.map((lead) => {
                const daysSince = lead.contacted_at
                  ? Math.floor(
                      (Date.now() -
                        new Date(lead.contacted_at).getTime()) /
                        (1000 * 60 * 60 * 24)
                    )
                  : 0;

                return (
                  <FollowUpRow
                    key={lead.id}
                    lead={lead}
                    daysSince={daysSince}
                    onActionComplete={() => handleActionComplete(lead.id)}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state for everything */}
      {totalTasks === 0 && visibleHotLeads.length === 0 && (
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

function HotLeadRow({
  lead,
  onActionComplete,
}: {
  lead: QueueLead;
  onActionComplete: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700">
      <ScoreBadge score={lead.score} />
      <Link
        href={`/leads/${lead.id}`}
        className="min-w-0 flex-1 outline-none"
      >
        <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-lime-400">
          {lead.business_name}
        </p>
        <p className="text-xs text-zinc-500">
          {[lead.city, lead.state].filter(Boolean).join(", ") ||
            lead.niche ||
            "—"}
          {lead.tech_stack && lead.tech_stack.length > 0 && (
            <span className="ml-2 text-zinc-600">{lead.tech_stack[0]}</span>
          )}
        </p>
      </Link>
      <Link
        href={`/leads/${lead.id}`}
        aria-label="Open lead"
        className="shrink-0 rounded-md p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
      <LeadActionMenu
        leadId={lead.id}
        hasWebsite={!!lead.website}
        alreadyContacted={lead.lifecycle_status === "contacted"}
        onActionComplete={onActionComplete}
      />
    </div>
  );
}

function FollowUpRow({
  lead,
  daysSince,
  onActionComplete,
}: {
  lead: QueueLead;
  daysSince: number;
  onActionComplete: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700">
      <ScoreBadge score={lead.score} />
      <Link href={`/leads/${lead.id}`} className="min-w-0 flex-1 outline-none">
        <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-lime-400">
          {lead.business_name}
        </p>
        <p className="text-xs text-zinc-500">
          Contacted {daysSince} days ago — no reply
        </p>
      </Link>
      <Link
        href={`/leads/${lead.id}`}
        aria-label="Open lead"
        className="shrink-0 rounded-md p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
      >
        <ChevronRight className="h-4 w-4" />
      </Link>
      <LeadActionMenu
        leadId={lead.id}
        hasWebsite={!!lead.website}
        alreadyContacted={true}
        onActionComplete={onActionComplete}
      />
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
