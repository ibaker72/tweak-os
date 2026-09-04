"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Loader2, ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * Convert to Account.
 *
 * Notice what this form does not collect: a commission rate. The rate is
 * snapshotted server-side inside convert_lead_to_account() from the owning
 * agent's profile, so it can never be chosen by whoever fills this in. The
 * deal is created as a draft for an admin to review and sign.
 */

interface Props {
  leadId: string;
  businessName: string;
  alreadyConverted: { accountId: string; dealId: string | null } | null;
}

const DEAL_TYPES = [
  { value: "rapid_build", label: "Rapid Build" },
  { value: "custom_engineering", label: "Custom Engineering" },
  { value: "growth_retainer", label: "Growth Retainer" },
] as const;

/** "8,500.00" or "8500" -> 850000 cents. Rejects anything with sub-cent parts. */
function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function ConvertToAccount({ leadId, businessName, alreadyConverted }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState(businessName);
  const [dealName, setDealName] = useState("");
  const [dealType, setDealType] = useState<string>("rapid_build");
  const [model, setModel] = useState<"one_time" | "recurring">("one_time");
  const [contractValue, setContractValue] = useState("");
  const [mrr, setMrr] = useState("");
  const [capMonths, setCapMonths] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  if (alreadyConverted) {
    return (
      <Card>
        <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <Building2 className="h-4 w-4 text-lime-400" />
            Converted
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <p className="text-sm text-zinc-400">
            This lead is already an account.
          </p>
          <Link
            href="/my/pipeline"
            className="mt-2 inline-flex items-center gap-1 text-sm text-lime-400 transition-colors hover:text-lime-300"
          >
            View in pipeline <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  async function submit() {
    // `disabled={saving}` is the visible guard, but React state lands on the
    // next render and a fast double-click can beat it. This is the cheap
    // belt-and-braces; the real guarantee is the unique index on
    // accounts.lead_id, which holds even when the browser does something odd.
    if (saving) return;

    setError(null);
    setNotice(null);

    const contractCents = dollarsToCents(contractValue);
    const mrrCents = dollarsToCents(mrr);

    if (contractCents === null || mrrCents === null) {
      setError("Amounts must be dollars and cents, e.g. 8500 or 8500.00");
      return;
    }
    if (model === "recurring" && mrrCents <= 0) {
      setError("A retainer needs a monthly amount above zero");
      return;
    }
    if (model === "one_time" && contractCents <= 0) {
      setError("A one-time deal needs a contract value above zero");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/leads/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          company_name: companyName.trim(),
          deal_name: dealName.trim() || `${companyName.trim()} deal`,
          deal_type: dealType,
          commission_model: model,
          contract_value_cents: model === "one_time" ? contractCents : 0,
          mrr_cents: model === "recurring" ? mrrCents : 0,
          recurring_cap_months:
            model === "recurring" && capMonths ? Number(capMonths) : null,
          primary_contact_name: contactName.trim() || null,
          primary_contact_email: contactEmail.trim() || null,
          primary_contact_phone: null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // A duplicate attempt is a success, not a failure. The server returns the
      // account that already exists, so say so rather than letting the panel
      // close as though this click did the work.
      if (data.status === "already_converted") {
        setNotice("Already converted — opening the account.");
      }

      router.refresh();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
          <Building2 className="h-4 w-4 text-lime-400" />
          Convert to Account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 sm:p-6">
        {!open ? (
          <>
            {notice && (
              <p className="rounded bg-lime-500/10 px-2 py-1.5 text-xs text-lime-300">
                {notice}
              </p>
            )}
            <p className="text-sm text-zinc-400">
              Turn this lead into a customer account with a draft deal.
            </p>
            <p className="text-xs text-zinc-600">
              Your commission rate is snapshotted onto the deal automatically. An admin
              reviews the contract value and signs it.
            </p>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              Convert
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <Field label="Company name">
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Deal name">
              <input
                value={dealName}
                onChange={(e) => setDealName(e.target.value)}
                placeholder={`${companyName} deal`}
                className={inputClass}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Deal type">
                <select
                  value={dealType}
                  onChange={(e) => setDealType(e.target.value)}
                  className={inputClass}
                >
                  {DEAL_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Commission model">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as "one_time" | "recurring")}
                  className={inputClass}
                >
                  <option value="one_time">One-time</option>
                  <option value="recurring">Recurring</option>
                </select>
              </Field>
            </div>

            {model === "one_time" ? (
              <Field label="Contract value (USD)">
                <input
                  value={contractValue}
                  onChange={(e) => setContractValue(e.target.value)}
                  inputMode="decimal"
                  placeholder="8500"
                  className={inputClass}
                />
              </Field>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Monthly (USD)">
                  <input
                    value={mrr}
                    onChange={(e) => setMrr(e.target.value)}
                    inputMode="decimal"
                    placeholder="3000"
                    className={inputClass}
                  />
                </Field>
                <Field label="Cap (months)">
                  <input
                    value={capMonths}
                    onChange={(e) => setCapMonths(e.target.value)}
                    inputMode="numeric"
                    placeholder="uncapped"
                    className={inputClass}
                  />
                </Field>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Contact name">
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Contact email">
                <input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  type="email"
                  className={inputClass}
                />
              </Field>
            </div>

            {error && (
              <p className="rounded bg-red-500/10 px-2 py-1.5 text-xs text-red-300">{error}</p>
            )}

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create account &amp; draft deal
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const inputClass =
  "w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
