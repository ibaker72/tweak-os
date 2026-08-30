"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Phone, PhoneCall, Mail, StickyNote, CalendarClock, ArrowRight, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * The daily driver.
 *
 * Built for speed: keyboard-first, optimistic, no navigation between actions.
 * j/k move, e logs an email, c logs a call, n adds a note, d sets the next
 * action date, and Enter opens the lead. Every action updates the row
 * immediately and reconciles against the server afterwards; a failure rolls
 * the row back and says so rather than leaving a lie on screen.
 *
 * Placing a real Twilio call is the one action with no keyboard shortcut, and
 * that is deliberate. `c` still opens the log-a-call composer it always has —
 * a keystroke that rings someone's phone is not something anyone should be
 * able to hit by accident. The Twilio call is its own labelled button and goes
 * through a confirmation dialog naming the business before anything dials.
 */

export interface QueueLead {
  id: string;
  business_name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  niche: string | null;
  score: number | null;
  priority: string | null;
  lifecycle_status: string;
  next_action: string | null;
  next_action_date: string | null;
  contacted_at: string | null;
}

type ActionKind = "log_call" | "log_email" | "add_note" | "set_next_action" | "advance_stage";

const STAGES = [
  "new",
  "enriched",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
  "not_a_fit",
] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dueClass(date: string | null): string {
  if (!date) return "text-zinc-600";
  const today = todayIso();
  if (date < today) return "text-red-400";
  if (date === today) return "text-lime-400";
  return "text-zinc-400";
}

function dueLabel(date: string | null): string {
  if (!date) return "unscheduled";
  const today = todayIso();
  if (date < today) return `overdue · ${date}`;
  if (date === today) return "today";
  return date;
}

export function QueueClient({ initialLeads }: { initialLeads: QueueLead[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [cursor, setCursor] = useState(0);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [composer, setComposer] = useState<{ kind: ActionKind; leadId: string } | null>(
    null
  );
  // The lead a Twilio call has been requested for and not yet confirmed.
  const [callTarget, setCallTarget] = useState<QueueLead | null>(null);
  const [calling, setCalling] = useState(false);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  const current = leads[cursor];

  const counts = useMemo(() => {
    const today = todayIso();
    return {
      overdue: leads.filter((l) => l.next_action_date && l.next_action_date < today).length,
      today: leads.filter((l) => l.next_action_date === today).length,
      unscheduled: leads.filter((l) => !l.next_action_date).length,
    };
  }, [leads]);

  const flash = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  /**
   * Apply the change locally first, then send it. On failure the previous row
   * is restored — an optimistic UI that keeps a failed write on screen is
   * worse than no optimism at all.
   */
  const run = useCallback(
    async (leadId: string, payload: Record<string, unknown>, optimistic: Partial<QueueLead>) => {
      const before = leads.find((l) => l.id === leadId);
      if (!before) return;

      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, ...optimistic } : l))
      );
      setPending((prev) => new Set(prev).add(leadId));

      try {
        const res = await fetch("/api/my/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, lead_id: leadId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (data.lead) {
          setLeads((prev) =>
            prev.map((l) => (l.id === leadId ? { ...l, ...data.lead } : l))
          );
        }
        flash("Saved");
      } catch (err) {
        setLeads((prev) => prev.map((l) => (l.id === leadId ? before : l)));
        flash(err instanceof Error ? err.message : "Action failed", "error");
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(leadId);
          return next;
        });
      }
    },
    [leads, flash]
  );

  /**
   * Place a Twilio click-to-call. Only ever reached from the confirm dialog.
   *
   * Sends lead_id and nothing else — the prospect's number, the agent's
   * callback number and the caller ID are all resolved server-side.
   */
  const placeCall = useCallback(async () => {
    const lead = callTarget;
    if (!lead) return;
    setCalling(true);
    try {
      const res = await fetch("/api/voice/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        flash(data.message ?? "Calling your phone…");
      } else {
        flash(data.message ?? "Could not place the call", "error");
      }
    } catch {
      flash("Network error while placing the call", "error");
    } finally {
      setCalling(false);
      setCallTarget(null);
    }
  }, [callTarget, flash]);

  // Keyboard handling. Ignored while a text field has focus so typing a note
  // does not fire the shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (leads.length === 0) return;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, leads.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case "c":
          e.preventDefault();
          if (current) setComposer({ kind: "log_call", leadId: current.id });
          break;
        case "e":
          e.preventDefault();
          if (current) setComposer({ kind: "log_email", leadId: current.id });
          break;
        case "n":
          e.preventDefault();
          if (current) setComposer({ kind: "add_note", leadId: current.id });
          break;
        case "d":
          e.preventDefault();
          if (current) setComposer({ kind: "set_next_action", leadId: current.id });
          break;
        case "s":
          e.preventDefault();
          if (current) setComposer({ kind: "advance_stage", leadId: current.id });
          break;
        case "Escape":
          setComposer(null);
          break;
        case "Enter":
          if (current) window.location.href = `/leads/${current.id}`;
          break;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [leads.length, current]);

  // Keep the cursor row in view as it moves.
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-10 text-center">
        <p className="text-sm text-zinc-400">Your queue is empty.</p>
        <p className="mt-1 text-xs text-zinc-600">
          Leads appear here once they are assigned to you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span className="text-red-400">{counts.overdue} overdue</span>
        <span className="text-lime-400">{counts.today} today</span>
        <span>{counts.unscheduled} unscheduled</span>
        <span className="ml-auto hidden font-mono text-[11px] text-zinc-600 sm:block">
          j/k move · c call · e email · n note · d date · s stage · ↵ open
        </span>
      </div>

      <ul className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800">
        {leads.map((lead, i) => {
          const active = i === cursor;
          const busy = pending.has(lead.id);

          return (
            <li
              key={lead.id}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              onClick={() => setCursor(i)}
              className={`cursor-pointer px-3 py-2.5 transition-colors sm:px-4 ${
                active ? "bg-zinc-800/70 ring-1 ring-inset ring-lime-400/40" : "bg-zinc-900/40 hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 w-10 shrink-0 text-right font-mono text-xs ${
                    (lead.score ?? 0) >= 70 ? "text-red-400" : "text-zinc-500"
                  }`}
                >
                  {lead.score ?? "—"}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-100">
                      {lead.business_name}
                    </span>
                    {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-zinc-500" />}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                    <span className={dueClass(lead.next_action_date)}>
                      {dueLabel(lead.next_action_date)}
                    </span>
                    {lead.next_action && (
                      <span className="truncate text-zinc-500">{lead.next_action}</span>
                    )}
                    <span className="text-zinc-600">{lead.lifecycle_status}</span>
                    {(lead.city || lead.niche) && (
                      <span className="hidden truncate text-zinc-600 sm:inline">
                        {[lead.niche, lead.city].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {lead.phone && (
                    <IconButton
                      title="Call via Twilio — rings your phone, then bridges"
                      onClick={() => setCallTarget(lead)}
                    >
                      <PhoneCall className="h-3.5 w-3.5 text-lime-500" />
                    </IconButton>
                  )}
                  <IconButton
                    title="Log call (c)"
                    onClick={() => setComposer({ kind: "log_call", leadId: lead.id })}
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    title="Log email (e)"
                    onClick={() => setComposer({ kind: "log_email", leadId: lead.id })}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    title="Add note (n)"
                    onClick={() => setComposer({ kind: "add_note", leadId: lead.id })}
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    title="Set next action (d)"
                    onClick={() => setComposer({ kind: "set_next_action", leadId: lead.id })}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                  </IconButton>
                  <Link
                    href={`/leads/${lead.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Open lead (↵)"
                    className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              {composer?.leadId === lead.id && (
                <Composer
                  kind={composer.kind}
                  lead={lead}
                  onCancel={() => setComposer(null)}
                  onSubmit={(payload, optimistic) => {
                    setComposer(null);
                    void run(lead.id, payload, optimistic);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={callTarget !== null}
        onOpenChange={(open) => {
          if (!open && !calling) setCallTarget(null);
        }}
        title={callTarget ? `Call ${callTarget.business_name}?` : "Call"}
        description={
          callTarget
            ? `Twilio rings your own phone first. Answer it and you are connected to ${callTarget.phone}, who sees the Tweak & Build number. This places a real call.`
            : ""
        }
        confirmLabel="Call now"
        busy={calling}
        onConfirm={placeCall}
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-3 py-2 text-sm shadow-lg ${
            toast.tone === "ok"
              ? "bg-lime-400/15 text-lime-300 ring-1 ring-lime-400/30"
              : "bg-red-500/15 text-red-300 ring-1 ring-red-500/30"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
    >
      {children}
    </button>
  );
}

function Composer({
  kind,
  lead,
  onCancel,
  onSubmit,
}: {
  kind: ActionKind;
  lead: QueueLead;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>, optimistic: Partial<QueueLead>) => void;
}) {
  const [note, setNote] = useState("");
  const [subject, setSubject] = useState("");
  const [outcome, setOutcome] = useState("connected");
  const [followUp, setFollowUp] = useState("3");
  const [stage, setStage] = useState(lead.lifecycle_status);
  const [nextAction, setNextAction] = useState(lead.next_action ?? "");
  const [nextDate, setNextDate] = useState(lead.next_action_date ?? todayIso());
  const firstField = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  function submit() {
    const days = Number(followUp);
    const inDays = (n: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };

    switch (kind) {
      case "log_call":
        onSubmit(
          {
            action: "log_call",
            note: note || undefined,
            outcome,
            follow_up_days: Number.isFinite(days) ? days : undefined,
            },
          {
            contacted_at: new Date().toISOString(),
            ...(Number.isFinite(days)
              ? { next_action_date: inDays(days), next_action: "Follow up on call" }
              : {}),
          }
        );
        break;
      case "log_email":
        onSubmit(
          {
            action: "log_email",
            note: note || undefined,
            subject: subject || undefined,
            follow_up_days: Number.isFinite(days) ? days : undefined,
          },
          {
            contacted_at: new Date().toISOString(),
            ...(Number.isFinite(days)
              ? { next_action_date: inDays(days), next_action: "Follow up on email" }
              : {}),
          }
        );
        break;
      case "add_note":
        if (!note.trim()) return;
        onSubmit({ action: "add_note", note }, {});
        break;
      case "set_next_action":
        onSubmit(
          {
            action: "set_next_action",
            next_action: nextAction || null,
            next_action_date: nextDate || null,
          },
          { next_action: nextAction || null, next_action_date: nextDate || null }
        );
        break;
      case "advance_stage":
        onSubmit(
          { action: "advance_stage", lifecycle_status: stage },
          { lifecycle_status: stage }
        );
        break;
    }
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        // Enter submits from a single-line field; Cmd/Ctrl+Enter from a textarea.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.currentTarget.tagName !== "TEXTAREA")) {
          const target = e.target as HTMLElement;
          if (target.tagName !== "TEXTAREA" || e.metaKey || e.ctrlKey) {
            e.preventDefault();
            submit();
          }
        }
      }}
      className="mt-2.5 space-y-2 rounded-md border border-zinc-700 bg-zinc-950/60 p-2.5"
    >
      {kind === "log_call" && (
        <div className="flex flex-wrap gap-2">
          <select
            ref={firstField as React.RefObject<HTMLSelectElement>}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          >
            <option value="connected">Connected</option>
            <option value="voicemail">Voicemail</option>
            <option value="no_answer">No answer</option>
            <option value="bad_number">Bad number</option>
          </select>
          <FollowUpSelect value={followUp} onChange={setFollowUp} />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened?"
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
      )}

      {kind === "log_email" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={firstField as React.RefObject<HTMLInputElement>}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
            />
            <FollowUpSelect value={followUp} onChange={setFollowUp} />
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Summary (optional)"
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
          />
        </div>
      )}

      {kind === "add_note" && (
        <textarea
          ref={firstField as React.RefObject<HTMLTextAreaElement>}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Note — ⌘↵ to save"
          className="w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
        />
      )}

      {kind === "set_next_action" && (
        <div className="flex flex-wrap gap-2">
          <input
            ref={firstField as React.RefObject<HTMLInputElement>}
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder="Next action"
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-600"
          />
          <input
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          />
        </div>
      )}

      {kind === "advance_stage" && (
        <select
          ref={firstField as React.RefObject<HTMLSelectElement>}
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="rounded bg-lime-400/90 px-2.5 py-1 text-xs font-medium text-zinc-950 transition-colors hover:bg-lime-400"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
        >
          Cancel
        </button>
        <span className="ml-auto font-mono text-[10px] text-zinc-600">esc to close</span>
      </div>
    </div>
  );
}

function FollowUpSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Follow-up reminder"
      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
    >
      <option value="">No reminder</option>
      <option value="1">Tomorrow</option>
      <option value="3">In 3 days</option>
      <option value="7">In a week</option>
      <option value="14">In 2 weeks</option>
      <option value="30">In a month</option>
    </select>
  );
}
