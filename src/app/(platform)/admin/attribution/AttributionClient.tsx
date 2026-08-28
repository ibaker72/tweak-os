"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Clock } from "lucide-react";

export interface ConflictClaim {
  id: string;
  agent_id: string;
  agent_name: string | null;
  source: string;
  first_touch_at: string;
  expires_at: string | null;
  is_override: boolean;
  override_reason: string | null;
}

export interface Conflict {
  leadId: string;
  lead_name: string | null;
  agentCount: number;
  decidedByOverride: boolean;
  margin_days: number | null;
  claims: ConflictClaim[];
  winner: ConflictClaim;
}

const MIN_REASON = 10;

export function AttributionClient({ conflicts }: { conflicts: Conflict[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function resolve(leadId: string, agentId: string, reason: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "override", lead_id: leadId, agent_id: agentId, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNotice("Credit assigned. The reason is stored on the attribution and in the activity log.");
      setOpen(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  if (conflicts.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <ShieldCheck className="mx-auto h-6 w-6 text-lime-400" />
          <p className="mt-2 text-sm text-zinc-400">No attribution conflicts.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Every lead has at most one agent holding a live claim.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-md bg-lime-400/10 px-3 py-2 text-sm text-lime-300">{notice}</div>
      )}

      {conflicts.map((conflict) => (
        <Card key={conflict.leadId}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link
                  href={`/leads/${conflict.leadId}`}
                  className="font-medium text-zinc-100 hover:text-lime-400"
                >
                  {conflict.lead_name ?? conflict.leadId}
                </Link>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {conflict.agentCount} agents claim this lead
                  {conflict.margin_days !== null && (
                    <span
                      className={
                        conflict.margin_days <= 1 ? "ml-1.5 text-amber-400" : "ml-1.5 text-zinc-600"
                      }
                    >
                      · decided by {conflict.margin_days} day
                      {conflict.margin_days === 1 ? "" : "s"}
                      {conflict.margin_days <= 1 && " — worth a look"}
                    </span>
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(open === conflict.leadId ? null : conflict.leadId)}
              >
                {open === conflict.leadId ? "Close" : "Resolve"}
              </Button>
            </div>

            <ul className="mt-3 space-y-1.5">
              {conflict.claims.map((claim, i) => (
                <li
                  key={claim.id}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-2 py-1.5 text-xs ${
                    i === 0 ? "bg-lime-400/5 ring-1 ring-inset ring-lime-400/20" : ""
                  }`}
                >
                  <span className={i === 0 ? "text-lime-400" : "text-zinc-400"}>
                    {i === 0 ? "→ " : "   "}
                    {claim.agent_name ?? claim.agent_id}
                  </span>
                  <span className="text-zinc-600">{claim.source.replace(/_/g, " ")}</span>
                  <span className="flex items-center gap-1 text-zinc-600">
                    <Clock className="h-3 w-3" />
                    {claim.first_touch_at.slice(0, 10)}
                  </span>
                  {claim.is_override && (
                    <span className="rounded bg-lime-400/10 px-1.5 py-0.5 text-[10px] text-lime-400">
                      override
                    </span>
                  )}
                  {claim.override_reason && (
                    <span className="w-full text-[11px] text-zinc-500">
                      &ldquo;{claim.override_reason}&rdquo;
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <p className="mt-2 text-[11px] text-zinc-600">
              {conflict.decidedByOverride
                ? "Currently decided by an admin override."
                : "Currently decided by earliest non-expired first touch."}
            </p>

            {open === conflict.leadId && (
              <ResolveForm
                conflict={conflict}
                busy={busy}
                onSubmit={(agentId, reason) => resolve(conflict.leadId, agentId, reason)}
              />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ResolveForm({
  conflict,
  busy,
  onSubmit,
}: {
  conflict: Conflict;
  busy: boolean;
  onSubmit: (agentId: string, reason: string) => void;
}) {
  const [agentId, setAgentId] = useState(conflict.winner.agent_id);
  const [reason, setReason] = useState("");

  const tooShort = reason.trim().length < MIN_REASON;

  return (
    <div className="mt-3 space-y-3 border-t border-zinc-800 pt-3">
      <label className="block">
        <span className="mb-1 block text-xs text-zinc-500">Credit goes to</span>
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
        >
          {conflict.claims.map((c) => (
            <option key={c.id} value={c.agent_id}>
              {c.agent_name ?? c.agent_id} — {c.source.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-zinc-500">Reason (required)</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why this agent gets the credit"
          className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
        <span className="mt-1 block text-[11px] text-zinc-600">
          Stored on the attribution itself, not just the log. This is the record if the split is
          ever disputed — including by the agent who did not get it.
        </span>
      </label>

      {reason.length > 0 && tooShort && (
        <p className="text-xs text-amber-400">Give a real reason, not a placeholder.</p>
      )}

      <Button size="sm" disabled={busy || tooShort} onClick={() => onSubmit(agentId, reason.trim())}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Assign credit
      </Button>
    </div>
  );
}
