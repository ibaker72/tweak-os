"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Wallet, Plus } from "lucide-react";
import { centsToDecimalString } from "@/lib/agent/commission-csv";

export interface AgentBalanceRow {
  id: string;
  display_name: string;
  email: string;
  is_active: boolean;
  partner_type: string;
  payout_method: string | null;
  payout_handle: string | null;
  unpaid_cents: number;
  payable_now_cents: number;
}

export interface BatchRow {
  id: string;
  agent_id: string;
  period_start: string;
  period_end: string;
  total_cents: number;
  method: string | null;
  status: string;
  paid_at: string | null;
  external_ref: string | null;
  created_at: string;
}

export interface DealOption {
  id: string;
  name: string;
  agent_id: string | null;
}

function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${centsToDecimalString(Math.abs(cents))}`;
}

function firstOfMonth(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CommissionsClient({
  agents,
  batches,
  deals,
}: {
  agents: AgentBalanceRow[];
  batches: BatchRow[];
  deals: DealOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batchFor, setBatchFor] = useState<AgentBalanceRow | null>(null);
  const [payingBatch, setPayingBatch] = useState<BatchRow | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const agentNames = new Map(agents.map((a) => [a.id, a.display_name]));

  async function post(url: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
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
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-md bg-lime-400/10 px-3 py-2 text-sm text-lime-300">{notice}</div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-300">Agent balances</h2>
        <Button variant="outline" size="sm" onClick={() => setAdjusting(true)}>
          <Plus className="h-3.5 w-3.5" />
          Manual entry
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Payout</th>
              <th className="px-3 py-2 text-right font-medium">Unpaid</th>
              <th className="px-3 py-2 text-right font-medium">Payable now</th>
              <th className="px-3 py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {agents.map((agent) => (
              <tr key={agent.id} className="hover:bg-zinc-900/50">
                <td className="px-3 py-2.5">
                  <div className="text-zinc-200">{agent.display_name}</div>
                  <div className="text-xs text-zinc-500">
                    {agent.email}
                    {!agent.is_active && <span className="ml-1.5 text-amber-400">inactive</span>}
                    {agent.partner_type === "referral_partner" && (
                      <span className="ml-1.5 text-zinc-600">partner</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-zinc-500">
                  {agent.payout_method ? (
                    <>
                      {agent.payout_method}
                      <div className="text-zinc-600">{agent.payout_handle ?? "no handle"}</div>
                    </>
                  ) : (
                    <span className="text-amber-400/80">not configured</span>
                  )}
                </td>
                <td
                  className={`px-3 py-2.5 text-right font-mono text-xs ${
                    agent.unpaid_cents < 0 ? "text-red-400" : "text-zinc-200"
                  }`}
                >
                  {usd(agent.unpaid_cents)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-lime-400">
                  {usd(agent.payable_now_cents)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={agent.payable_now_cents === 0 || busy !== null}
                    onClick={() => setBatchFor(agent)}
                    title={
                      agent.payable_now_cents === 0
                        ? "Nothing has passed Net 30 yet"
                        : "Create a payout batch"
                    }
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    Batch
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600">
        Only entries past their Net 30 payable date are batched. A negative balance carries
        against future earnings rather than being written off.
      </p>

      <h2 className="pt-2 text-sm font-medium text-zinc-300">Payout batches</h2>
      {batches.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-zinc-500">
            No batches yet.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {batches.map((batch) => (
                <tr key={batch.id} className="hover:bg-zinc-900/50">
                  <td className="px-3 py-2.5 text-zinc-200">
                    {agentNames.get(batch.agent_id) ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-zinc-400">
                    {batch.period_start} → {batch.period_end}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-200">
                    {usd(batch.total_cents)}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <span
                      className={
                        batch.status === "paid"
                          ? "text-lime-400"
                          : batch.status === "failed"
                            ? "text-red-400"
                            : "text-zinc-400"
                      }
                    >
                      {batch.status}
                    </span>
                    {batch.paid_at && (
                      <span className="ml-1.5 text-zinc-600">{batch.paid_at.slice(0, 10)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-zinc-500">
                    {batch.external_ref ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {batch.status !== "paid" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => setPayingBatch(batch)}
                      >
                        Mark paid
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {batchFor && (
        <Modal title={`Create payout batch — ${batchFor.display_name}`} onClose={() => setBatchFor(null)}>
          <BatchForm
            agent={batchFor}
            busy={busy === "batch"}
            onSubmit={async (period) => {
              const data = await post(
                "/api/admin/commissions",
                { action: "create_batch", agent_id: batchFor.id, ...period },
                "batch"
              );
              if (data) {
                setNotice(
                  `Batched ${data.entriesStamped} entr${data.entriesStamped === 1 ? "y" : "ies"} totalling ${usd(data.totalCents)}.`
                );
                setBatchFor(null);
              }
            }}
          />
        </Modal>
      )}

      {payingBatch && (
        <Modal title="Mark batch paid" onClose={() => setPayingBatch(null)}>
          <MarkPaidForm
            batch={payingBatch}
            busy={busy === "paid"}
            onSubmit={async (externalRef) => {
              const data = await post(
                "/api/admin/commissions",
                { action: "mark_paid", batch_id: payingBatch.id, external_ref: externalRef },
                "paid"
              );
              if (data) {
                setNotice("Batch marked paid.");
                setPayingBatch(null);
              }
            }}
          />
        </Modal>
      )}

      {adjusting && (
        <Modal title="Manual ledger entry" onClose={() => setAdjusting(false)}>
          <AdjustForm
            agents={agents}
            deals={deals}
            busy={busy === "adjust"}
            onSubmit={async (payload) => {
              const data = await post("/api/admin/commissions/adjust", payload, "adjust");
              if (data) {
                setNotice("Entry written to the ledger.");
                setAdjusting(false);
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
      >
        <h3 className="mb-3 text-sm font-medium text-zinc-200">{title}</h3>
        {children}
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-600">{hint}</span>}
    </label>
  );
}

function BatchForm({
  agent,
  busy,
  onSubmit,
}: {
  agent: AgentBalanceRow;
  busy: boolean;
  onSubmit: (period: { period_start: string; period_end: string; method: string | null }) => void;
}) {
  const [start, setStart] = useState(firstOfMonth());
  const [end, setEnd] = useState(today());
  const [method, setMethod] = useState(agent.payout_method ?? "");

  return (
    <div className="space-y-3">
      <p className="rounded bg-zinc-800/60 px-2 py-1.5 text-xs text-zinc-400">
        {usd(agent.payable_now_cents)} is past its Net 30 date and will be included. Anything
        still pending stays in the balance for a later batch.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Period start">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Period end">
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="Method">
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
          <option value="">Not specified</option>
          <option value="stripe">Stripe</option>
          <option value="paypal">PayPal</option>
        </select>
      </Field>
      <Button
        size="sm"
        disabled={busy}
        onClick={() =>
          onSubmit({ period_start: start, period_end: end, method: method || null })
        }
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Create batch
      </Button>
    </div>
  );
}

function MarkPaidForm({
  batch,
  busy,
  onSubmit,
}: {
  batch: BatchRow;
  busy: boolean;
  onSubmit: (externalRef: string) => void;
}) {
  const [ref, setRef] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        {usd(batch.total_cents)} for {batch.period_start} → {batch.period_end}
      </p>
      <Field
        label="External reference"
        hint="The transfer id, cheque number, or whatever proves this money moved. Required — a payout with no reference cannot be verified later."
      >
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="po_1234 / cheque 0142"
          className={inputClass}
          autoFocus
        />
      </Field>
      <Button size="sm" disabled={busy || ref.trim() === ""} onClick={() => onSubmit(ref.trim())}>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Mark paid
      </Button>
    </div>
  );
}

function AdjustForm({
  agents,
  deals,
  busy,
  onSubmit,
}: {
  agents: AgentBalanceRow[];
  deals: DealOption[];
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [type, setType] = useState<"adjustment" | "bonus">("bonus");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  const cents = (() => {
    const cleaned = amount.replace(/[$,\s]/g, "");
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
    const negative = cleaned.startsWith("-");
    const [whole, fraction = ""] = cleaned.replace("-", "").split(".");
    const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return negative ? -value : value;
  })();

  const memoTooShort = memo.trim().length < 10;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Agent">
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={inputClass}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "adjustment" | "bonus")}
            className={inputClass}
          >
            <option value="bonus">Bonus (positive)</option>
            <option value="adjustment">Adjustment (either way)</option>
          </select>
        </Field>
      </div>

      <Field label="Deal" hint="Every entry attaches to a deal, so the ledger stays reconcilable.">
        <select value={dealId} onChange={(e) => setDealId(e.target.value)} className={inputClass}>
          {deals.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Amount (USD)"
        hint={type === "adjustment" ? "Prefix with - to deduct." : "Bonuses must be positive."}
      >
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="500.00"
          className={inputClass}
        />
      </Field>

      <Field
        label="Memo (required)"
        hint="This is the only explanation that will exist when someone asks about this line in six months."
      >
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
          placeholder="Why this entry exists"
          className={`${inputClass} resize-y`}
        />
      </Field>

      {memo.length > 0 && memoTooShort && (
        <p className="text-xs text-amber-400">
          Give a real reason — this is the record if the amount is ever questioned.
        </p>
      )}

      <Button
        size="sm"
        disabled={busy || cents === null || cents === 0 || memoTooShort || !dealId}
        onClick={() =>
          onSubmit({
            agent_id: agentId,
            deal_id: dealId,
            entry_type: type,
            amount_cents: cents,
            memo: memo.trim(),
          })
        }
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Write entry
      </Button>
      <p className="text-[11px] text-zinc-600">
        Ledger entries cannot be edited or deleted. A mistake is corrected with a further
        offsetting entry.
      </p>
    </div>
  );
}
