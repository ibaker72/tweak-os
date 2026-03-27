"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  Linkedin,
  Phone,
  Send,
  Clock,
  Save,
  X,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/lib/leads/types";
import {
  type OutreachTemplate,
  type TemplateVariables,
  fillTemplate,
} from "@/lib/leads/outreach-templates";

interface OutreachComposeProps {
  lead: Lead;
  onClose: () => void;
  defaultChannel?: string;
}

const channelTabs = [
  { value: "email", label: "Email", icon: Mail },
  { value: "linkedin", label: "LinkedIn", icon: Linkedin },
  { value: "phone", label: "Phone Log", icon: Phone },
];

export function OutreachCompose({
  lead,
  onClose,
  defaultChannel = "email",
}: OutreachComposeProps) {
  const router = useRouter();
  const [channel, setChannel] = useState(defaultChannel);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/outreach/templates")
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => {});
  }, []);

  function getVars(): TemplateVariables {
    const loadTime = lead.page_load_time_ms
      ? (lead.page_load_time_ms / 1000).toFixed(1)
      : "unknown";
    const lostPercent = lead.page_load_time_ms
      ? lead.page_load_time_ms > 5000
        ? "53"
        : lead.page_load_time_ms > 3000
          ? "32"
          : "10"
      : "unknown";
    const missingItems =
      [
        !lead.has_ssl ? "SSL certificate" : null,
        !lead.is_mobile_responsive ? "mobile optimization" : null,
        !lead.has_blog ? "blog/content" : null,
      ]
        .filter(Boolean)
        .join(", ") || "none detected";

    return {
      business_name: lead.business_name,
      platform: lead.tech_stack?.[0] ?? "their current platform",
      niche: lead.niche || lead.category || "local",
      metric: "a 40% increase in conversions",
      load_time: loadTime,
      lost_percent: lostPercent,
      performance_grade: lead.performance_grade || "N/A",
      mobile_status: lead.is_mobile_responsive
        ? "Responsive"
        : "Not mobile-friendly",
      missing_items: missingItems,
    };
  }

  function handleTemplateSelect(template: OutreachTemplate) {
    const filled = fillTemplate(template, getVars());
    setSubject(filled.subject ?? "");
    setBody(filled.body);
    setChannel(template.channel === "follow_up" ? "email" : template.channel);
  }

  async function handleSend(mode: "send" | "schedule" | "draft") {
    setSending(true);
    try {
      const status = mode === "send" ? "sent" : "draft";
      await fetch("/api/outreach/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id,
          channel,
          subject: subject || undefined,
          body: body || undefined,
          status,
          scheduled_for: mode === "schedule" ? scheduledFor : undefined,
        }),
      });

      // If sending now and first touch, mark as contacted
      if (mode === "send") {
        await fetch("/api/leads", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: lead.id,
            lifecycle_status: "contacted",
            last_contacted_via: channel,
          }),
        });
      }

      router.refresh();
      onClose();
    } catch (err) {
      console.error("Outreach send error:", err);
    } finally {
      setSending(false);
    }
  }

  const filteredTemplates = templates.filter(
    (t) => t.channel === channel || t.channel === "follow_up"
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h3 className="text-base font-medium text-zinc-100">
            Compose Outreach — {lead.business_name}
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Channel Tabs */}
        <div className="flex border-b border-zinc-800">
          {channelTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.value}
                onClick={() => setChannel(tab.value)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                  channel === tab.value
                    ? "border-b-2 border-lime-400 text-lime-400"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="space-y-4 p-5">
          {/* Template selector */}
          {filteredTemplates.length > 0 && (
            <div>
              <label className="text-xs text-zinc-500">Quick Fill from Template</label>
              <div className="mt-1 flex flex-wrap gap-1">
                {filteredTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleTemplateSelect(t)}
                    className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-700"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {channel === "email" && (
            <div>
              <label className="text-xs text-zinc-500">Subject</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject line..."
                className="mt-1"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-zinc-500">
              {channel === "phone" ? "Call Notes" : "Message"}
            </label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                channel === "phone"
                  ? "Log call notes..."
                  : "Write your message..."
              }
              rows={8}
              className="mt-1"
            />
          </div>

          {/* Schedule input */}
          <div>
            <label className="text-xs text-zinc-500">
              Schedule For (optional)
            </label>
            <Input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="mt-1 w-64"
            />
          </div>

          {/* Preview */}
          {showPreview && body && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <p className="mb-1 text-[10px] font-medium uppercase text-zinc-500">
                Preview
              </p>
              {subject && (
                <p className="mb-2 text-sm font-medium text-zinc-200">
                  {subject}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm text-zinc-300">
                {body}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="h-4 w-4" />
            {showPreview ? "Hide Preview" : "Preview"}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSend("draft")}
              disabled={sending || !body}
            >
              <Save className="h-4 w-4" />
              Save Draft
            </Button>
            {scheduledFor && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleSend("schedule")}
                disabled={sending || !body}
              >
                <Clock className="h-4 w-4" />
                Schedule
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => handleSend("send")}
              disabled={sending || !body}
            >
              <Send className="h-4 w-4" />
              {sending ? "Sending..." : "Send Now"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
