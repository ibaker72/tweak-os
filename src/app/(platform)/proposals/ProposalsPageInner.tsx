"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Sparkles,
  Loader2,
  Copy,
  Check,
  Save,
  Download,
  AlertTriangle,
  Eye,
} from "lucide-react";
import {
  BUSINESS_TYPES,
  SERVICE_CATALOG,
  SERVICE_GROUPS,
  type ProposalService,
  type ProposalStatus,
  type Proposal,
} from "@/lib/proposals/types";
import { renderMarkdown } from "@/lib/markdown";
import { formatDate } from "@/lib/utils";

function moneyFmt(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

const STATUS_VARIANTS: Record<ProposalStatus, { label: string; classes: string }> = {
  draft: { label: "Draft", classes: "bg-zinc-700/60 text-zinc-300" },
  sent: { label: "Sent", classes: "bg-blue-500/15 text-blue-300" },
  won: { label: "Won", classes: "bg-lime-500/15 text-lime-400" },
  lost: { label: "Lost", classes: "bg-red-500/15 text-red-300" },
};

const STATUS_OPTIONS: ProposalStatus[] = ["draft", "sent", "won", "lost"];

export function ProposalsPageInner() {
  const params = useSearchParams();
  const presetUrl = params.get("url") ?? "";
  const presetLeadId = params.get("lead_id") ?? undefined;
  const presetAuditId = params.get("audit_id") ?? undefined;

  const [clientName, setClientName] = useState("");
  const [businessType, setBusinessType] = useState<string>(BUSINESS_TYPES[0]);
  const [websiteUrl, setWebsiteUrl] = useState(presetUrl);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");

  const [generating, setGenerating] = useState(false);
  const [proposal, setProposal] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);

  // If URL is supplied via query string but client_name isn't, prefill from domain.
  useEffect(() => {
    if (presetUrl && !clientName) {
      try {
        const host = new URL(
          presetUrl.startsWith("http") ? presetUrl : `https://${presetUrl}`
        ).hostname.replace(/^www\./, "");
        const root = host.split(".")[0];
        if (root) setClientName(root.charAt(0).toUpperCase() + root.slice(1));
      } catch {
        // Ignore — user can still type a name.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetUrl]);

  useEffect(() => {
    loadProposals();
  }, []);

  async function loadProposals() {
    setProposalsLoading(true);
    try {
      const res = await fetch("/api/proposals");
      if (res.ok) {
        const data = await res.json();
        setProposals(data.proposals ?? []);
      }
    } catch {
      // Silent — list just stays empty.
    } finally {
      setProposalsLoading(false);
    }
  }

  const selectedServices = useMemo<ProposalService[]>(() => {
    const out: ProposalService[] = [];
    for (const item of SERVICE_CATALOG) {
      if (!selectedIds.has(item.id)) continue;
      out.push({
        name: item.name,
        price: item.price,
        billing: item.billing,
      });
      if (item.secondary) {
        out.push({
          name: `${item.name} (recurring)`,
          price: item.secondary.price,
          billing: item.secondary.billing,
        });
      }
    }
    return out;
  }, [selectedIds]);

  const totals = useMemo(() => {
    let oneTime = 0;
    let monthly = 0;
    for (const svc of selectedServices) {
      if (svc.billing === "one-time") oneTime += svc.price;
      else monthly += svc.price;
    }
    return { oneTime, monthly };
  }, [selectedServices]);

  function toggleService(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    setGenerating(true);
    setProposal("");
    setError(null);
    setSavedMsg(null);

    try {
      const res = await fetch("/api/proposals/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          business_type: businessType,
          website_url: websiteUrl,
          selected_services: selectedServices,
          notes,
          audit_id: presetAuditId,
          lead_id: presetLeadId,
        }),
      });

      if (!res.ok || !res.body) {
        let msg = "Generation failed";
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {
          // Fall through to default error.
        }
        setError(msg);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setProposal(accumulated);
      }

      // Refresh recent proposals once stream completes (server persisted it).
      loadProposals();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(proposal);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave() {
    if (!proposal.trim()) return;
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          business_type: businessType,
          selected_services: selectedServices,
          proposal_html: proposal,
          lead_id: presetLeadId,
        }),
      });
      if (res.ok) {
        setSavedMsg("Proposal saved");
        setTimeout(() => setSavedMsg(null), 2500);
        loadProposals();
      } else {
        setError("Failed to save proposal");
      }
    } catch {
      setError("Network error while saving");
    }
  }

  function handleDownload() {
    window.print();
  }

  async function handleStatusChange(id: string, status: ProposalStatus) {
    try {
      const res = await fetch("/api/proposals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) loadProposals();
    } catch {
      // Silent — user can retry.
    }
  }

  return (
    <div className="space-y-6 print:space-y-0">
      <div className="print:hidden">
        <DashboardHeader
          title="Proposal Generator"
          description="Build a personalized proposal with AI"
        />
      </div>

      {/* Recent proposals */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5 text-lime-400" />
            Recent Proposals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {proposalsLoading ? (
            <p className="text-sm text-zinc-500">Loading...</p>
          ) : proposals.length === 0 ? (
            <p className="text-sm text-zinc-500">No proposals yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                    <th className="px-3 py-2">Client</th>
                    <th className="px-3 py-2">Business Type</th>
                    <th className="px-3 py-2">Total Value</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {proposals.map((p) => (
                    <ProposalRow
                      key={p.id}
                      proposal={p}
                      onStatusChange={handleStatusChange}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 print:gap-0 lg:grid-cols-5">
        {/* LEFT — form */}
        <div className="space-y-4 lg:col-span-2 print:hidden">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Client & Services</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Client Name
                </label>
                <Input
                  className="mt-1.5"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Acme HVAC"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Business Type
                  </label>
                  <Select
                    className="mt-1.5"
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                  >
                    {BUSINESS_TYPES.map((bt) => (
                      <option key={bt} value={bt}>
                        {bt}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Website URL
                  </label>
                  <Input
                    className="mt-1.5"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://acme-hvac.com"
                  />
                </div>
              </div>

              <div className="space-y-4 border-t border-zinc-800 pt-4">
                {SERVICE_GROUPS.map((group) => {
                  const items = SERVICE_CATALOG.filter(
                    (svc) => svc.group === group.id
                  );
                  return (
                    <div key={group.id}>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
                        {group.label}
                      </p>
                      <div className="space-y-1.5">
                        {items.map((svc) => {
                          const checked = selectedIds.has(svc.id);
                          return (
                            <label
                              key={svc.id}
                              className="flex cursor-pointer items-center gap-2.5 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm transition-colors hover:border-zinc-700"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleService(svc.id)}
                                className="h-4 w-4 cursor-pointer accent-lime-400"
                              />
                              <span className="flex-1 text-zinc-200">{svc.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Running Total
                </p>
                <p className="mt-1 text-sm text-zinc-100">
                  <span className="text-zinc-400">One-time:</span>{" "}
                  <span className="font-semibold">{moneyFmt(totals.oneTime)}</span>
                  <span className="mx-2 text-zinc-700">|</span>
                  <span className="text-zinc-400">Monthly:</span>{" "}
                  <span className="font-semibold">{moneyFmt(totals.monthly)}/mo</span>
                </p>
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Notes
                </label>
                <Textarea
                  className="mt-1.5"
                  rows={4}
                  placeholder="Any context about this lead, their goals, or what they asked about..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <Button
                className="w-full"
                onClick={handleGenerate}
                disabled={generating || selectedServices.length === 0}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Proposal
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — preview */}
        <div className="lg:col-span-3">
          <Card className="proposal-preview-card">
            <CardHeader className="print:hidden">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye className="h-5 w-5 text-lime-400" />
                  Preview
                </CardTitle>
                {generating && (
                  <Badge variant="secondary" className="text-[10px]">
                    Streaming...
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-red-900 bg-red-950/40 p-3 print:hidden">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              <div
                id="proposal-preview"
                className="min-h-[500px] rounded-lg border border-zinc-800 bg-zinc-950/60 p-5 print:min-h-0 print:border-0 print:bg-white print:p-0 print:text-black"
              >
                {proposal ? (
                  <>
                    <div className="mb-5 border-b border-zinc-800 pb-3 print:border-zinc-300">
                      <p className="text-xs font-semibold uppercase tracking-widest text-lime-400 print:text-zinc-700">
                        Tweak &amp; Build
                      </p>
                      <p className="text-sm text-zinc-400 print:text-zinc-700">
                        Proposal {clientName ? `for ${clientName}` : ""}
                      </p>
                    </div>
                    <div
                      className="proposal-markdown"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(proposal) }}
                    />
                  </>
                ) : (
                  <p className="py-12 text-center text-sm text-zinc-500 print:hidden">
                    Your proposal will appear here
                  </p>
                )}
              </div>

              {proposal && (
                <div className="flex flex-wrap gap-2 print:hidden">
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 text-lime-400" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        Copy Text
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSave}>
                    <Save className="h-4 w-4" />
                    Save Proposal
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="h-4 w-4" />
                    Download PDF
                  </Button>
                  {savedMsg && (
                    <span className="self-center text-xs text-lime-400">
                      {savedMsg}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Print styles: only show the preview card, white background, black text */}
      <style jsx global>{`
        @media print {
          body {
            background: white !important;
          }
          aside,
          header,
          nav,
          .print\\:hidden {
            display: none !important;
          }
          main {
            margin: 0 !important;
            padding: 0 !important;
          }
          .proposal-preview-card {
            border: 0 !important;
            box-shadow: none !important;
            background: white !important;
          }
          #proposal-preview,
          #proposal-preview * {
            color: black !important;
            background: white !important;
            border-color: #ddd !important;
          }
          .proposal-markdown h1,
          .proposal-markdown h2,
          .proposal-markdown h3 {
            color: black !important;
          }
          .proposal-markdown a {
            color: #65a30d !important;
          }
        }
      `}</style>
    </div>
  );
}

function ProposalRow({
  proposal,
  onStatusChange,
}: {
  proposal: Proposal;
  onStatusChange: (id: string, status: ProposalStatus) => void;
}) {
  const variant = STATUS_VARIANTS[proposal.status];
  return (
    <tr className="text-sm">
      <td className="px-3 py-2 text-zinc-100">{proposal.client_name || "—"}</td>
      <td className="px-3 py-2 text-zinc-400">{proposal.business_type || "—"}</td>
      <td className="px-3 py-2 text-zinc-300">
        {moneyFmt(Number(proposal.total_one_time || 0))}
        {Number(proposal.total_monthly || 0) > 0 && (
          <span className="text-xs text-zinc-500">
            {" "}
            + {moneyFmt(Number(proposal.total_monthly || 0))}/mo
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${variant.classes}`}
        >
          {variant.label}
        </span>
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500">
        {formatDate(proposal.created_at)}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex items-center gap-2">
          <Select
            value={proposal.status}
            onChange={(e) =>
              onStatusChange(proposal.id, e.target.value as ProposalStatus)
            }
            className="h-7 w-28 text-xs"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      </td>
    </tr>
  );
}
