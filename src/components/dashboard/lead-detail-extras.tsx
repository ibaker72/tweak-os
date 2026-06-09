"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/leads/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { OutreachTimeline } from "./outreach-timeline";
import { OutreachCompose } from "./outreach-compose";
import {
  UserCircle,
  Calendar,
  Flag,
  Mail,
  Phone as PhoneIcon,
  CalendarClock,
  Trophy,
  XCircle,
} from "lucide-react";
import { LEAD_PRIORITIES } from "@/lib/shared/constants";

interface LeadDetailExtrasProps {
  lead: Lead;
  agents: { id: string; display_name: string }[];
}

export function LeadDetailExtras({ lead, agents }: LeadDetailExtrasProps) {
  const router = useRouter();
  const [showCompose, setShowCompose] = useState(false);
  const [assignedTo, setAssignedTo] = useState(
    (lead as unknown as Record<string, unknown>).assigned_to as string ?? ""
  );
  const [priority, setPriority] = useState(
    (lead as unknown as Record<string, unknown>).priority as string ?? "normal"
  );
  const [nextAction, setNextAction] = useState(
    (lead as unknown as Record<string, unknown>).next_action as string ?? ""
  );
  const [nextActionDate, setNextActionDate] = useState(
    (lead as unknown as Record<string, unknown>).next_action_date as string ?? ""
  );
  const [saving, setSaving] = useState(false);

  async function handleSaveAssignment() {
    setSaving(true);
    try {
      await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lead.id,
          assigned_to: assignedTo || null,
          priority,
          next_action: nextAction || null,
          next_action_date: nextActionDate || null,
        }),
      });
      router.refresh();
    } catch (err) {
      console.error("Save assignment error:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickAction(action: string) {
    const updates: Record<string, unknown> = { id: lead.id };

    switch (action) {
      case "log_call":
        setShowCompose(true);
        return;
      case "send_email":
        setShowCompose(true);
        return;
      case "schedule_followup": {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        updates.next_action = "Follow up";
        updates.next_action_date = tomorrow.toISOString().split("T")[0];
        break;
      }
      case "mark_won":
        updates.lifecycle_status = "won";
        break;
      case "mark_lost":
        updates.lifecycle_status = "lost";
        break;
    }

    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    router.refresh();
  }

  return (
    <>
      {/* Assignment & Priority Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserCircle className="h-5 w-5 text-lime-400" />
            Assignment & Priority
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-zinc-500">Assigned To</label>
              <Select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="mt-1"
              >
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.display_name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500">Priority</label>
              <Select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1"
              >
                {LEAD_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-zinc-500">Next Action</label>
              <Input
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                placeholder="e.g., Send follow-up email"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500">Action Date</label>
              <Input
                type="date"
                value={nextActionDate}
                onChange={(e) => setNextActionDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <Button size="sm" onClick={handleSaveAssignment} disabled={saving}>
            {saving ? "Saving..." : "Save Assignment"}
          </Button>
        </CardContent>
      </Card>

      {/* Outreach Timeline */}
      <OutreachTimeline leadId={lead.id} />

      {/* Quick Actions Bar — desktop only; mobile uses the new primary action bar in lead-detail-card */}
      <div className="hidden md:block sticky bottom-4 z-20">
        <Card className="border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl">
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <span className="mr-2 text-xs font-medium text-zinc-500">Quick Actions:</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleQuickAction("send_email")}
            >
              <Mail className="h-3.5 w-3.5" />
              Send Email
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleQuickAction("log_call")}
            >
              <PhoneIcon className="h-3.5 w-3.5" />
              Log Call
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleQuickAction("schedule_followup")}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule Follow-up
            </Button>
            <div className="hidden sm:block h-6 w-px bg-zinc-700" />
            <Button
              size="sm"
              variant="ghost"
              className="text-green-400 hover:text-green-300"
              onClick={() => handleQuickAction("mark_won")}
            >
              <Trophy className="h-3.5 w-3.5" />
              Won
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-400 hover:text-red-300"
              onClick={() => handleQuickAction("mark_lost")}
            >
              <XCircle className="h-3.5 w-3.5" />
              Lost
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Compose Dialog */}
      {showCompose && (
        <OutreachCompose
          lead={lead}
          onClose={() => setShowCompose(false)}
        />
      )}
    </>
  );
}
