"use client";

import { useState, useEffect } from "react";
import {
  Mail,
  Linkedin,
  Phone,
  MessageSquare,
  Plus,
  ChevronDown,
  ChevronUp,
  Send,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { OUTREACH_CHANNELS, SEQUENCE_STATUSES } from "@/lib/shared/constants";

interface SequenceEntry {
  id: string;
  lead_id: string;
  channel: string;
  sequence_step: number;
  subject: string | null;
  body: string | null;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  replied_at: string | null;
  scheduled_for: string | null;
  notes: string | null;
  created_at: string;
}

interface OutreachTimelineProps {
  leadId: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-400 border-zinc-600",
  sent: "bg-blue-500/10 text-blue-400 border-blue-600",
  opened: "bg-amber-500/10 text-amber-400 border-amber-600",
  replied: "bg-green-500/10 text-green-400 border-green-600",
  bounced: "bg-red-500/10 text-red-400 border-red-600",
};

const channelIcons: Record<string, typeof Mail> = {
  email: Mail,
  linkedin: Linkedin,
  phone: Phone,
  other: MessageSquare,
};

export function OutreachTimeline({ leadId }: OutreachTimelineProps) {
  const [entries, setEntries] = useState<SequenceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    channel: "email",
    subject: "",
    body: "",
    scheduled_for: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchEntries();
  }, [leadId]);

  async function fetchEntries() {
    try {
      const res = await fetch(`/api/outreach/sequences?lead_id=${leadId}`);
      const data = await res.json();
      setEntries(data.sequences ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddEntry() {
    setSubmitting(true);
    try {
      await fetch("/api/outreach/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          channel: formData.channel,
          subject: formData.subject || undefined,
          body: formData.body || undefined,
          scheduled_for: formData.scheduled_for || undefined,
          status: formData.scheduled_for ? "draft" : "draft",
        }),
      });
      setShowForm(false);
      setFormData({ channel: "email", subject: "", body: "", scheduled_for: "" });
      await fetchEntries();
    } catch (err) {
      console.error("Failed to add sequence:", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkSent(id: string) {
    await fetch("/api/outreach/sequences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "sent" }),
    });
    await fetchEntries();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Send className="h-5 w-5 text-lime-400" />
            Outreach Timeline
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="h-4 w-4" />
            Add Touchpoint
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add form */}
        {showForm && (
          <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500">Channel</label>
                <Select
                  value={formData.channel}
                  onChange={(e) =>
                    setFormData({ ...formData, channel: e.target.value })
                  }
                  className="mt-1"
                >
                  {OUTREACH_CHANNELS.map((ch) => (
                    <option key={ch.value} value={ch.value}>
                      {ch.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-xs text-zinc-500">Schedule For</label>
                <Input
                  type="date"
                  value={formData.scheduled_for}
                  onChange={(e) =>
                    setFormData({ ...formData, scheduled_for: e.target.value })
                  }
                  className="mt-1"
                />
              </div>
            </div>
            {formData.channel === "email" && (
              <div>
                <label className="text-xs text-zinc-500">Subject</label>
                <Input
                  value={formData.subject}
                  onChange={(e) =>
                    setFormData({ ...formData, subject: e.target.value })
                  }
                  placeholder="Email subject line..."
                  className="mt-1"
                />
              </div>
            )}
            <div>
              <label className="text-xs text-zinc-500">Message</label>
              <Textarea
                value={formData.body}
                onChange={(e) =>
                  setFormData({ ...formData, body: e.target.value })
                }
                placeholder="Outreach message..."
                rows={4}
                className="mt-1"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddEntry} disabled={submitting}>
                {submitting ? "Saving..." : "Save Touchpoint"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Timeline */}
        {loading ? (
          <p className="text-sm text-zinc-500">Loading timeline...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No outreach yet. Click &quot;Add Touchpoint&quot; to start.
          </p>
        ) : (
          <div className="relative space-y-0">
            {/* Vertical line */}
            <div className="absolute left-[19px] top-2 bottom-2 w-px bg-zinc-800" />

            {entries.map((entry) => {
              const Icon = channelIcons[entry.channel] ?? MessageSquare;
              const statusStyle = statusColors[entry.status] ?? statusColors.draft;
              const isExpanded = expandedId === entry.id;
              const date =
                entry.sent_at ?? entry.scheduled_for ?? entry.created_at;

              return (
                <div key={entry.id} className="relative flex gap-3 pb-4 pl-0">
                  {/* Timeline dot */}
                  <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
                    <Icon className="h-4 w-4 text-zinc-400" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`text-[10px] ${statusStyle}`}>
                        {SEQUENCE_STATUSES.find((s) => s.value === entry.status)
                          ?.label ?? entry.status}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        Step {entry.sequence_step}
                      </Badge>
                      <span className="text-[10px] text-zinc-500">
                        {formatDate(date)}
                      </span>
                      {entry.status === "draft" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 text-[10px]"
                          onClick={() => handleMarkSent(entry.id)}
                        >
                          Mark Sent
                        </Button>
                      )}
                    </div>

                    {entry.subject && (
                      <p className="mt-1 text-sm font-medium text-zinc-200">
                        {entry.subject}
                      </p>
                    )}

                    <p className="mt-1 text-xs text-zinc-400">
                      {isExpanded
                        ? entry.body
                        : entry.body?.slice(0, 80) +
                          (entry.body && entry.body.length > 80 ? "..." : "")}
                    </p>

                    {entry.body && entry.body.length > 80 && (
                      <button
                        onClick={() =>
                          setExpandedId(isExpanded ? null : entry.id)
                        }
                        className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-3 w-3" /> Less
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3" /> More
                          </>
                        )}
                      </button>
                    )}

                    {entry.notes && (
                      <p className="mt-2 text-[10px] italic text-zinc-600">
                        Note: {entry.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
