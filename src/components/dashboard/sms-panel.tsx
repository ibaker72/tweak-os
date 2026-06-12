"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Phone,
  MessageSquare,
  Send,
  Eye,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Ban,
  HelpCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate } from "@/lib/utils";
import type { Lead, SmsMessage, SmsStatus } from "@/lib/leads/types";
import {
  SMS_TEMPLATES,
  fillSmsTemplate,
  SMS_DISABLED_MESSAGE,
  SMS_COMPLIANCE_NOTE,
  SMS_SEND_WARNING,
  SMS_OPT_BACK_IN_WARNING,
} from "@/lib/sms/templates";

interface SmsPanelProps {
  lead: Lead;
  messages: SmsMessage[];
  sendingEnabled: boolean;
}

function firstNameFromBusiness(name: string): string {
  // Fall back to the first word of the business name when we don't have
  // a real first name on the lead. The templates default to "there" if
  // this still ends up blank.
  if (!name) return "";
  const tokens = name.trim().split(/\s+/);
  return tokens[0] ?? "";
}

const SMS_STATUS_LABEL: Record<SmsStatus, string> = {
  allowed: "Allowed",
  opted_out: "Opted out",
  do_not_contact: "Do not contact",
  unknown: "Unknown",
};

const SMS_STATUS_VARIANT: Record<SmsStatus, "default" | "secondary" | "destructive" | "warning" | "success" | "info"> = {
  allowed: "success",
  opted_out: "destructive",
  do_not_contact: "warning",
  unknown: "secondary",
};

export function SmsPanel({ lead, messages, sendingEnabled }: SmsPanelProps) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [showPreview, setShowPreview] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "info" | "error" | "success"; text: string } | null>(null);

  const [smsStatus, setSmsStatus] = useState<SmsStatus>(lead.sms_status ?? "unknown");
  const [pendingStatusChange, setPendingStatusChange] = useState<SmsStatus | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const phone = lead.phone ?? lead.phone_1 ?? "";
  const hasPhone = phone.trim().length > 0;

  const templateValues = useMemo(
    () => ({
      first_name: firstNameFromBusiness(lead.business_name),
      proposal_link: "https://tweakandbuild.com/proposal",
      date: "",
      time: "",
      email: lead.email ?? lead.email_1 ?? "",
    }),
    [lead.business_name, lead.email, lead.email_1]
  );

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const template = SMS_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    setDraft(fillSmsTemplate(template, templateValues));
  }

  async function performSend() {
    setSending(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id,
          body: draft,
          confirm_send: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFeedback({ tone: "success", text: "SMS queued for delivery." });
        setDraft("");
        setSelectedTemplateId("");
        router.refresh();
      } else if (data.status === "disabled") {
        setFeedback({ tone: "info", text: "SMS prepared — waiting for Twilio A2P approval. Draft saved." });
        router.refresh();
      } else {
        setFeedback({
          tone: "error",
          text: data.message ?? "Could not send SMS.",
        });
      }
    } catch (err) {
      console.error("SMS send error", err);
      setFeedback({ tone: "error", text: "Network error while sending SMS." });
    } finally {
      setSending(false);
      setShowConfirm(false);
    }
  }

  async function handleSendClick() {
    if (!sendingEnabled) {
      // Sending is gated globally — still let the user save the draft
      // through the same endpoint so we get a log row.
      await performSend();
      return;
    }
    setShowConfirm(true);
  }

  async function changeStatus(next: SmsStatus, confirmOptBackIn = false) {
    setStatusSaving(true);
    try {
      const res = await fetch("/api/sms/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: lead.id,
          sms_status: next,
          confirm_opt_back_in: confirmOptBackIn,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setSmsStatus(next);
        router.refresh();
      } else if (data.reason === "requires_opt_back_in_confirmation") {
        setPendingStatusChange(next);
      } else {
        setFeedback({ tone: "error", text: data.message ?? "Could not update SMS status." });
      }
    } catch (err) {
      console.error("SMS status update error", err);
      setFeedback({ tone: "error", text: "Network error while updating SMS status." });
    } finally {
      setStatusSaving(false);
    }
  }

  function onStatusSelectChange(value: SmsStatus) {
    if (value === smsStatus) return;
    if (smsStatus === "opted_out" && value === "allowed") {
      setPendingStatusChange("allowed");
      return;
    }
    changeStatus(value);
  }

  const lastSent = lead.last_sms_sent_at;
  const lastReceived = lead.last_sms_received_at;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-lime-400" />
            SMS Follow-up
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={SMS_STATUS_VARIANT[smsStatus]}>
              {SMS_STATUS_LABEL[smsStatus]}
            </Badge>
            {!sendingEnabled && (
              <Badge variant="warning" className="gap-1">
                <ShieldAlert className="h-3 w-3" />
                {SMS_DISABLED_MESSAGE}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recipient overview */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Phone</p>
            <p className="flex items-center gap-1.5 text-sm text-zinc-200">
              <Phone className="h-3.5 w-3.5 text-zinc-500" />
              {hasPhone ? phone : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Last sent</p>
            <p className="text-sm text-zinc-200">
              {lastSent ? formatDate(lastSent) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Last received</p>
            <p className="text-sm text-zinc-200">
              {lastReceived ? formatDate(lastReceived) : "—"}
            </p>
          </div>
        </div>

        {/* SMS status control */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs font-medium uppercase text-zinc-500">SMS Status</label>
            <Select
              value={smsStatus}
              onChange={(e) => onStatusSelectChange(e.target.value as SmsStatus)}
              className="mt-1"
              disabled={statusSaving}
            >
              <option value="allowed">Allowed</option>
              <option value="opted_out">Opted out</option>
              <option value="do_not_contact">Do not contact</option>
              <option value="unknown">Unknown</option>
            </Select>
          </div>
          <p className="text-xs text-zinc-500 max-w-md">
            Admin control. Opt-outs from inbound STOP messages are honored automatically.
          </p>
        </div>

        {/* Template selector */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium uppercase text-zinc-500">Template</label>
            <Select
              value={selectedTemplateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="mt-1"
            >
              <option value="">— Choose a template —</option>
              {SMS_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <p className="text-xs text-zinc-500">
              Templates already include the Tweak & Build brand and STOP language.
            </p>
          </div>
        </div>

        {/* Draft body */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium uppercase text-zinc-500">Message</label>
            <span className={`text-xs ${draft.length > 320 ? "text-amber-400" : "text-zinc-500"}`}>
              {draft.length} chars
            </span>
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="Draft your SMS here…"
          />
        </div>

        {/* Compliance note */}
        <p className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
          {SMS_COMPLIANCE_NOTE}
        </p>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(true)}
            disabled={!draft.trim()}
          >
            <Eye className="h-4 w-4" />
            Preview
          </Button>
          <Button
            size="sm"
            onClick={handleSendClick}
            disabled={
              sending ||
              !draft.trim() ||
              !hasPhone ||
              smsStatus === "opted_out" ||
              smsStatus === "do_not_contact"
            }
            title={
              !hasPhone
                ? "No phone number on this lead"
                : smsStatus === "opted_out"
                ? "Lead has opted out"
                : smsStatus === "do_not_contact"
                ? "Lead is marked do-not-contact"
                : !sendingEnabled
                ? "SMS sending is disabled until A2P approval"
                : undefined
            }
          >
            <Send className="h-4 w-4" />
            {sendingEnabled ? "Send SMS" : "Save Draft"}
          </Button>
        </div>

        {feedback && (
          <p
            className={`text-sm ${
              feedback.tone === "error"
                ? "text-red-400"
                : feedback.tone === "success"
                  ? "text-lime-400"
                  : "text-amber-300"
            }`}
          >
            {feedback.text}
          </p>
        )}

        {/* Message history */}
        {messages.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500 mb-2">History</p>
            <div className="space-y-2">
              {messages.map((m) => (
                <SmsHistoryRow key={m.id} message={m} />
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {/* Preview modal — read-only */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <h3 className="text-base font-medium text-zinc-100">Preview SMS</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500 mb-1">To</p>
                <p className="text-sm text-zinc-200">{hasPhone ? phone : "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500 mb-1">Body</p>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{draft}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
              <Button variant="outline" size="sm" onClick={() => setShowPreview(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Send modal */}
      <ConfirmDialog
        open={showConfirm}
        onOpenChange={(open) => !sending && setShowConfirm(open)}
        title={`Send SMS to ${lead.business_name}`}
        description={`Recipient: ${hasPhone ? phone : "—"}\n\nMessage:\n${draft}\n\n${SMS_SEND_WARNING}`}
        confirmLabel="Confirm Send"
        busy={sending}
        onConfirm={performSend}
      />

      {/* Confirm opt-back-in modal */}
      <ConfirmDialog
        open={pendingStatusChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
        title="Mark lead as allowed again?"
        description={SMS_OPT_BACK_IN_WARNING}
        confirmLabel="Yes, mark allowed"
        tone="destructive"
        busy={statusSaving}
        onConfirm={async () => {
          if (pendingStatusChange) {
            await changeStatus(pendingStatusChange, true);
            setPendingStatusChange(null);
          }
        }}
      />
    </Card>
  );
}

function SmsHistoryRow({ message }: { message: SmsMessage }) {
  const tone =
    message.direction === "inbound"
      ? "text-blue-300"
      : message.status === "sent" || message.status === "delivered"
        ? "text-lime-300"
        : message.status === "disabled"
          ? "text-amber-300"
          : message.status === "blocked" || message.status === "failed"
            ? "text-red-300"
            : "text-zinc-300";

  const icon =
    message.direction === "inbound" ? (
      <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
    ) : message.status === "blocked" ? (
      <Ban className="h-3.5 w-3.5 text-red-400" />
    ) : message.status === "disabled" ? (
      <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
    ) : message.status === "failed" ? (
      <XCircle className="h-3.5 w-3.5 text-red-400" />
    ) : message.status === "draft" ? (
      <HelpCircle className="h-3.5 w-3.5 text-zinc-400" />
    ) : (
      <CheckCircle2 className="h-3.5 w-3.5 text-lime-400" />
    );

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 text-xs">
          {icon}
          <span className={`uppercase ${tone}`}>
            {message.direction === "inbound" ? "Inbound" : "Outbound"} · {message.status}
          </span>
        </div>
        <span className="text-xs text-zinc-500">{formatDate(message.created_at)}</span>
      </div>
      <p className="text-sm text-zinc-300 whitespace-pre-wrap">{message.body}</p>
      {message.error_message && (
        <p className="mt-1 text-xs text-amber-300">{message.error_message}</p>
      )}
    </div>
  );
}
