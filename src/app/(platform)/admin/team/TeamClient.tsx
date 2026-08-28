"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, ArrowRightLeft } from "lucide-react";

export interface TeamAgent {
  id: string;
  display_name: string;
  email: string;
  role: string;
  is_active: boolean;
  partner_type: string;
  default_commission_rate_bps: number;
  inbound_commission_rate_bps: number;
  payout_method: string | null;
  payout_handle: string | null;
  employment_classification: string;
  legal_name: string | null;
  tax_address: string | null;
  tax_id_last4: string | null;
  started_at: string | null;
  existing_deal_count: number;
  existing_rates_bps: number[];
}

const inputClass =
  "w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600";

function bpsToPct(bps: number): string {
  return (bps / 100).toFixed(2);
}

function pctToBps(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  return Math.round(Number(value) * 100);
}

export function TeamClient({ agents, currentAdminId }: { agents: TeamAgent[]; currentAdminId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState<TeamAgent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function post(body: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      router.refresh();
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-md bg-lime-400/10 px-3 py-2 text-sm text-lime-300">{notice}</div>
      )}

      {agents.map((agent) => (
        <Card key={agent.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-100">{agent.display_name}</span>
                  {!agent.is_active && (
                    <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                      inactive
                    </span>
                  )}
                  {agent.role === "admin" && (
                    <span className="rounded bg-lime-400/10 px-1.5 py-0.5 text-[10px] text-lime-400">
                      admin
                    </span>
                  )}
                  {agent.partner_type === "referral_partner" && (
                    <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300">
                      partner
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">{agent.email}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span className="text-zinc-400">
                    Self-sourced{" "}
                    <span className="font-mono text-zinc-200">
                      {bpsToPct(agent.default_commission_rate_bps)}%
                    </span>
                  </span>
                  <span className="text-zinc-400">
                    Inbound{" "}
                    <span className="font-mono text-zinc-200">
                      {bpsToPct(agent.inbound_commission_rate_bps)}%
                    </span>
                  </span>
                  <span className="text-zinc-500">
                    {agent.employment_classification === "unset"
                      ? "classification unset"
                      : agent.employment_classification === "contractor_1099"
                        ? "1099 contractor"
                        : "W-2 employee"}
                  </span>
                  <span className="text-zinc-500">
                    {agent.payout_method
                      ? `${agent.payout_method} · ${agent.payout_handle ?? "no handle"}`
                      : "no payout method"}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(editing === agent.id ? null : agent.id)}
                >
                  {editing === agent.id ? "Close" : "Edit"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setReassigning(agent)}>
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  Book
                </Button>
              </div>
            </div>

            {editing === agent.id && (
              <EditForm
                agent={agent}
                busy={busy}
                isSelf={agent.id === currentAdminId}
                onSubmit={async (updates) => {
                  const data = await post({ action: "update", agent_id: agent.id, ...updates });
                  if (data) {
                    setNotice(
                      data.rate_changed
                        ? "Rate updated. Deals converted from now on use the new rate; existing deals keep the rate they were signed at."
                        : "Agent updated."
                    );
                    setEditing(null);
                  }
                }}
              />
            )}
          </CardContent>
        </Card>
      ))}

      {reassigning && (
        <ReassignModal
          agent={reassigning}
          candidates={agents.filter((a) => a.id !== reassigning.id && a.is_active)}
          busy={busy}
          isSelf={reassigning.id === currentAdminId}
          onClose={() => setReassigning(null)}
          onSubmit={async (toAgentId, deactivate) => {
            const data = await post({
              action: "reassign_book",
              from_agent_id: reassigning.id,
              to_agent_id: toAgentId,
              deactivate,
            });
            if (data) {
              setNotice(
                `Moved ${data.leads_moved} lead${data.leads_moved === 1 ? "" : "s"} and ` +
                  `${data.accounts_moved} account${data.accounts_moved === 1 ? "" : "s"}. ` +
                  "Closed deals and commission entries were left untouched."
              );
              setReassigning(null);
            }
          }}
        />
      )}
    </div>
  );
}

function EditForm({
  agent,
  busy,
  isSelf,
  onSubmit,
}: {
  agent: TeamAgent;
  busy: boolean;
  isSelf: boolean;
  onSubmit: (updates: Record<string, unknown>) => void;
}) {
  const [selfRate, setSelfRate] = useState(bpsToPct(agent.default_commission_rate_bps));
  const [inboundRate, setInboundRate] = useState(bpsToPct(agent.inbound_commission_rate_bps));
  const [classification, setClassification] = useState(agent.employment_classification);
  const [partnerType, setPartnerType] = useState(agent.partner_type);
  const [payoutMethod, setPayoutMethod] = useState(agent.payout_method ?? "");
  const [payoutHandle, setPayoutHandle] = useState(agent.payout_handle ?? "");
  const [legalName, setLegalName] = useState(agent.legal_name ?? "");
  const [taxAddress, setTaxAddress] = useState(agent.tax_address ?? "");
  const [taxLast4, setTaxLast4] = useState(agent.tax_id_last4 ?? "");
  const [active, setActive] = useState(agent.is_active);

  const selfBps = pctToBps(selfRate);
  const inboundBps = pctToBps(inboundRate);
  const rateWillChange =
    (selfBps !== null && selfBps !== agent.default_commission_rate_bps) ||
    (inboundBps !== null && inboundBps !== agent.inbound_commission_rate_bps);

  return (
    <div className="mt-4 space-y-3 border-t border-zinc-800 pt-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Self-sourced rate (%)">
          <input value={selfRate} onChange={(e) => setSelfRate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Inbound rate (%)" hint="Applied when an inbound_assigned attribution is on file.">
          <input
            value={inboundRate}
            onChange={(e) => setInboundRate(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {rateWillChange && (
        <div className="flex gap-2 rounded-md bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Future deals only.</strong> {agent.display_name} has{" "}
            {agent.existing_deal_count} existing deal
            {agent.existing_deal_count === 1 ? "" : "s"}
            {agent.existing_rates_bps.length > 0 && (
              <>
                {" "}
                at {agent.existing_rates_bps.map((b) => `${bpsToPct(b)}%`).join(", ")}
              </>
            )}
            . Those keep the rate snapshotted when they were converted and will not be repriced.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Classification">
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
            className={inputClass}
          >
            <option value="unset">Not set</option>
            <option value="contractor_1099">1099 contractor</option>
            <option value="employee_w2">W-2 employee</option>
          </select>
        </Field>
        <Field label="Partner type">
          <select
            value={partnerType}
            onChange={(e) => setPartnerType(e.target.value)}
            className={inputClass}
          >
            <option value="internal_agent">Internal agent</option>
            <option value="referral_partner">Referral partner</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payout method">
          <select
            value={payoutMethod}
            onChange={(e) => setPayoutMethod(e.target.value)}
            className={inputClass}
          >
            <option value="">Not set</option>
            <option value="stripe">Stripe</option>
            <option value="paypal">PayPal</option>
          </select>
        </Field>
        <Field label="Payout handle">
          <input
            value={payoutHandle}
            onChange={(e) => setPayoutHandle(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {classification === "contractor_1099" && (
        <div className="space-y-3 rounded-md border border-zinc-800 p-3">
          <p className="text-xs text-zinc-500">
            For 1099 reporting. Only the last four digits of the TIN are stored here — the full
            number belongs wherever the 1099 is actually filed.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Legal name">
              <input
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="TIN last 4">
              <input
                value={taxLast4}
                onChange={(e) => setTaxLast4(e.target.value)}
                maxLength={4}
                inputMode="numeric"
                placeholder="1234"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={taxAddress}
              onChange={(e) => setTaxAddress(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={active}
          disabled={isSelf}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
        />
        Active
        {isSelf && <span className="text-xs text-zinc-600">(cannot deactivate yourself)</span>}
      </label>

      <Button
        size="sm"
        disabled={busy || selfBps === null || inboundBps === null}
        onClick={() =>
          onSubmit({
            default_commission_rate_bps: selfBps,
            inbound_commission_rate_bps: inboundBps,
            employment_classification: classification,
            partner_type: partnerType,
            payout_method: payoutMethod || null,
            payout_handle: payoutHandle || null,
            legal_name: legalName || null,
            tax_address: taxAddress || null,
            tax_id_last4: taxLast4 || null,
            ...(isSelf ? {} : { is_active: active }),
          })
        }
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save
      </Button>
    </div>
  );
}

function ReassignModal({
  agent,
  candidates,
  busy,
  isSelf,
  onClose,
  onSubmit,
}: {
  agent: TeamAgent;
  candidates: TeamAgent[];
  busy: boolean;
  isSelf: boolean;
  onClose: () => void;
  onSubmit: (toAgentId: string, deactivate: boolean) => void;
}) {
  const [to, setTo] = useState(candidates[0]?.id ?? "");
  const [deactivate, setDeactivate] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
      >
        <h3 className="text-sm font-medium text-zinc-200">
          Reassign {agent.display_name}&apos;s book
        </h3>

        <p className="rounded bg-zinc-800/60 px-2 py-1.5 text-xs text-zinc-400">
          Moves open leads and active accounts. Closed deals and every commission entry stay
          with {agent.display_name} — commission already earned is theirs, and a reassignment
          that moved it would be indistinguishable from taking it.
        </p>

        {candidates.length === 0 ? (
          <p className="text-sm text-amber-400">No other active agent to reassign to.</p>
        ) : (
          <>
            <Field label="Move to">
              <select value={to} onChange={(e) => setTo(e.target.value)} className={inputClass}>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={deactivate}
                disabled={isSelf}
                onChange={(e) => setDeactivate(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
              />
              Also deactivate {agent.display_name}
              {isSelf && <span className="text-xs text-zinc-600">(not yourself)</span>}
            </label>

            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !to} onClick={() => onSubmit(to, deactivate)}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Reassign
              </Button>
              <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-600">{hint}</span>}
    </label>
  );
}
