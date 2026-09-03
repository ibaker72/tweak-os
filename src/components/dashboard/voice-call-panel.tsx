"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PhoneCall,
  Phone,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Clock,
  PhoneOff,
  NotebookPen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate } from "@/lib/utils";
import { formatPhoneNumber, maskPhoneNumber } from "@/lib/phone";
import type { Lead, VoiceCall, VoiceCallStatus } from "@/lib/leads/types";

/**
 * Click-to-call on the lead page.
 *
 * "Call via Twilio" rings the agent's own phone and bridges to the prospect
 * once they answer. "Log Call" stays right beside it for calls made outside
 * Tweak OS — the two are separate actions with separate buttons precisely so
 * that nobody has to guess which one dials a real phone.
 *
 * The request body is `{ lead_id }` and nothing else. The prospect's number,
 * the agent's callback number and the caller ID are all resolved server-side;
 * there is deliberately no way to pass any of them from here.
 */

interface VoiceCallPanelProps {
  lead: Lead;
  calls: VoiceCall[];
  /** TWILIO_VOICE_ENABLED, read on the server. */
  voiceEnabled: boolean;
  /** The signed-in agent's own callback number, or null if unset. */
  agentVoicePhone: string | null;
}

const STATUS_LABEL: Record<VoiceCallStatus, string> = {
  requested: "Requested",
  disabled: "Not placed",
  initiated: "Dialing you",
  ringing: "Ringing",
  "in-progress": "In progress",
  completed: "Completed",
  busy: "Busy",
  "no-answer": "No answer",
  failed: "Failed",
  canceled: "Canceled",
};

type Feedback = { tone: "info" | "error" | "success"; text: string; detail?: string | null };

const CALL_OUTCOMES = [
  { value: "connected", label: "Connected" },
  { value: "voicemail", label: "Voicemail" },
  { value: "no_answer", label: "No answer" },
  { value: "bad_number", label: "Bad number" },
] as const;

export function VoiceCallPanel({
  lead,
  calls,
  voiceEnabled,
  agentVoicePhone,
}: VoiceCallPanelProps) {
  const router = useRouter();
  const [calling, setCalling] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [showLogForm, setShowLogForm] = useState(false);
  const [logOutcome, setLogOutcome] = useState<string>("connected");
  const [logNote, setLogNote] = useState("");
  const [logging, setLogging] = useState(false);

  const prospectPhone = lead.phone ?? lead.phone_1 ?? "";
  const hasPhone = prospectPhone.trim().length > 0;
  const hasCallbackNumber = Boolean(agentVoicePhone);
  const doNotContact = lead.sms_status === "do_not_contact";

  async function placeCall() {
    setCalling(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/voice/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // lead_id only. Anything else is rejected by the route.
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setFeedback({
          tone: "success",
          text: data.message ?? "Calling your phone… Answer to connect to the prospect.",
        });
      } else {
        setFeedback({
          tone: data.reason === "disabled" ? "info" : "error",
          text: data.message ?? "Could not place the call.",
          detail: data.error_message ?? null,
        });
      }
      // Refresh either way: a disabled or failed attempt is still a row in the
      // history, and hiding it would make the button look like it did nothing.
      router.refresh();
    } catch (err) {
      console.error("Voice call error", err);
      setFeedback({ tone: "error", text: "Network error while placing the call." });
    } finally {
      setCalling(false);
      setShowConfirm(false);
    }
  }

  async function submitLog() {
    setLogging(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/my/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "log_call",
          lead_id: lead.id,
          outcome: logOutcome,
          note: logNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFeedback({ tone: "success", text: "Call logged." });
        setShowLogForm(false);
        setLogNote("");
        router.refresh();
      } else {
        setFeedback({ tone: "error", text: data.error ?? "Could not log the call." });
      }
    } catch (err) {
      console.error("Log call error", err);
      setFeedback({ tone: "error", text: "Network error while logging the call." });
    } finally {
      setLogging(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <PhoneCall className="h-5 w-5 text-lime-400" />
            Calling
          </CardTitle>
          {!voiceEnabled && (
            <Badge variant="warning" className="gap-1">
              <ShieldAlert className="h-3 w-3" />
              Twilio Voice disabled
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Prospect</p>
            <p className="flex items-center gap-1.5 text-sm text-zinc-200">
              <Phone className="h-3.5 w-3.5 text-zinc-500" />
              {hasPhone
                ? formatPhoneNumber(prospectPhone)
                : "No phone number on this lead"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-zinc-500">Rings your phone</p>
            {/* Masked: enough to recognise it as yours, and it is sitting on a
                page full of prospect data it has no business being read off. */}
            <p className="text-sm text-zinc-200">
              {agentVoicePhone ? (
                <span title="Your callback number, set in Settings">
                  {maskPhoneNumber(agentVoicePhone)}
                </span>
              ) : (
                <Link href="/settings" className="text-lime-400 underline underline-offset-2">
                  Add your callback number
                </Link>
              )}
            </p>
          </div>
        </div>

        <p className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
          Twilio calls your phone first. Answer it and you are connected to the
          prospect, who sees the Tweak &amp; Build number — never your own.
          Calls are not recorded.
        </p>

        {/* Actions — the real call and the manual log, side by side and
            unmistakably different buttons. */}
        <div className="flex flex-wrap gap-2">
          {hasPhone && (
            <Button
              size="sm"
              onClick={() => setShowConfirm(true)}
              disabled={calling || !hasCallbackNumber || doNotContact}
              title={
                !hasCallbackNumber
                  ? "Add your callback phone number before using Twilio calling"
                  : doNotContact
                    ? "This lead is marked do-not-contact"
                    : !voiceEnabled
                      ? "Twilio Voice is currently disabled"
                      : undefined
              }
            >
              <PhoneCall className="h-4 w-4" />
              {calling ? "Placing call…" : "Call via Twilio"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLogForm((v) => !v)}
            disabled={logging}
          >
            <NotebookPen className="h-4 w-4" />
            Log Call
          </Button>
        </div>

        {!hasPhone && (
          <p className="text-sm text-amber-300">
            This lead has no phone number, so there is nothing to call. Add one
            to enable Twilio calling.
          </p>
        )}
        {hasPhone && !hasCallbackNumber && (
          <p className="text-sm text-amber-300">
            Add your callback phone number before using Twilio calling.{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Open Settings
            </Link>
            .
          </p>
        )}

        {/* Manual log — for a call made outside Tweak OS. */}
        {showLogForm && (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <p className="text-xs text-zinc-500">
              For a call you made outside Tweak OS.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium uppercase text-zinc-500">Outcome</label>
                <Select
                  value={logOutcome}
                  onChange={(e) => setLogOutcome(e.target.value)}
                  className="mt-1"
                >
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Textarea
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
              rows={3}
              placeholder="What happened on the call?"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={submitLog} disabled={logging}>
                {logging ? "Saving…" : "Save call log"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowLogForm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {feedback && (
          <div>
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
            {feedback.detail && (
              // Twilio's own words. A suspended account says so here rather
              // than hiding behind a generic failure.
              <p className="mt-1 font-mono text-xs text-zinc-500">{feedback.detail}</p>
            )}
          </div>
        )}

        {calls.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-zinc-500">Recent calls</p>
            <div className="space-y-2">
              {calls.map((call) => (
                <VoiceCallRow key={call.id} call={call} />
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={showConfirm}
        onOpenChange={(open) => !calling && setShowConfirm(open)}
        title={`Call ${lead.business_name}?`}
        description={
          voiceEnabled
            ? `Twilio will ring ${
                agentVoicePhone ? maskPhoneNumber(agentVoicePhone) : "your phone"
              } first. Answer it and you will be connected to ${formatPhoneNumber(
                prospectPhone
              )}, who sees the Tweak & Build number.`
            : "Twilio Voice is currently disabled, so no call will be placed. The attempt will be recorded in this lead's call history."
        }
        confirmLabel={voiceEnabled ? "Call now" : "Record the attempt"}
        busy={calling}
        onConfirm={placeCall}
      />
    </Card>
  );
}

function VoiceCallRow({ call }: { call: VoiceCall }) {
  const tone =
    call.status === "completed"
      ? "text-lime-300"
      : call.status === "disabled"
        ? "text-amber-300"
        : call.status === "failed" || call.status === "canceled"
          ? "text-red-300"
          : "text-zinc-300";

  const icon =
    call.status === "completed" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-lime-400" />
    ) : call.status === "disabled" ? (
      <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
    ) : call.status === "failed" || call.status === "canceled" ? (
      <XCircle className="h-3.5 w-3.5 text-red-400" />
    ) : call.status === "busy" || call.status === "no-answer" ? (
      <PhoneOff className="h-3.5 w-3.5 text-zinc-400" />
    ) : (
      <Clock className="h-3.5 w-3.5 text-zinc-400" />
    );

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs">
          {icon}
          <span className={`uppercase ${tone}`}>{STATUS_LABEL[call.status]}</span>
          {call.duration_seconds !== null && (
            <span className="text-zinc-500">· {call.duration_seconds}s</span>
          )}
        </div>
        <span className="text-xs text-zinc-500">{formatDate(call.created_at)}</span>
      </div>
      {call.error_message && (
        <p className="mt-1 text-xs text-amber-300">{call.error_message}</p>
      )}
    </div>
  );
}
