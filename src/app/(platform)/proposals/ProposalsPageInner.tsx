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
  Mail,
  Pencil,
  Sun,
  Moon,
} from "lucide-react";
import {
  BUSINESS_TYPES,
  SERVICE_CATALOG,
  SERVICE_GROUPS,
  type ProposalService,
  type ProposalStatus,
  type Proposal,
  type ProposalSections,
} from "@/lib/proposals/types";
import {
  buildDefaultSections,
  emptySections,
  parseSectionsFromMarkdown,
  sectionsToMarkdown,
  sectionsToPlainText,
  slugifyClient,
} from "@/lib/proposals/sections";
import { formatDate } from "@/lib/utils";
import { ProposalComposer } from "@/components/proposals/ProposalComposer";
import { ProposalPreview } from "@/components/proposals/ProposalPreview";
import { EmailProposalModal, type EmailProposalPayload } from "@/components/proposals/EmailProposalModal";
import { Toast, type ToastTone } from "@/components/proposals/Toast";

function moneyFmt(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function detectBusinessType(url: string, fallback: string): string {
  const u = url.toLowerCase();
  if (u.includes("garage") && u.includes("door")) return "Garage Door Contractor";
  if (u.includes("hvac")) return "HVAC";
  if (u.includes("plumb")) return "Plumbing";
  if (u.includes("roof")) return "Roofing";
  if (u.includes("auto") || u.includes("dealer") || u.includes("motor")) return "Auto Dealer";
  return fallback;
}

const STATUS_VARIANTS: Record<ProposalStatus, { label: string; classes: string }> = {
  draft: { label: "Draft", classes: "bg-zinc-700/60 text-zinc-300" },
  saved: { label: "Saved", classes: "bg-cyan-500/15 text-cyan-300" },
  sent: { label: "Sent", classes: "bg-blue-500/15 text-blue-300" },
  active: { label: "Active", classes: "bg-lime-500/20 text-lime-300 ring-1 ring-lime-400/40" },
  won: { label: "Won", classes: "bg-lime-500/15 text-lime-400" },
  lost: { label: "Lost", classes: "bg-red-500/15 text-red-300" },
  obsolete: { label: "Obsolete", classes: "bg-zinc-800/70 text-zinc-500" },
  archived: { label: "Archived", classes: "bg-zinc-800/70 text-zinc-500" },
};

const STATUS_OPTIONS: ProposalStatus[] = [
  "draft",
  "saved",
  "sent",
  "active",
  "won",
  "lost",
  "obsolete",
  "archived",
];

const MUTED_STATUSES: ReadonlySet<ProposalStatus> = new Set([
  "obsolete",
  "archived",
]);

const DEFAULT_EMAIL_INTRO = (clientName: string, recipientName: string) => `Hey ${recipientName || "there"},

I put together a quick website and local SEO plan for ${clientName || "your business"} based on the audit we ran.

The main opportunity I saw is that the current site could be doing a better job capturing more local search demand and turning visitors into calls or quote requests.

I attached the proposal here for you to review.

Best,
Iyad
Tweak & Build`;

export function ProposalsPageInner() {
  const params = useSearchParams();
  const presetUrl = params.get("url") ?? "";
  const presetLeadId = params.get("lead_id") ?? undefined;
  const presetAuditId = params.get("audit_id") ?? undefined;

  const [clientName, setClientName] = useState("");
  const [businessType, setBusinessType] = useState<string>(
    detectBusinessType(presetUrl, "Home Services")
  );
  const [websiteUrl, setWebsiteUrl] = useState(presetUrl);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");

  const [generating, setGenerating] = useState(false);
  const [sections, setSections] = useState<ProposalSections>(emptySections());
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [emailOpen, setEmailOpen] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");

  const [previewTheme, setPreviewTheme] = useState<"dark" | "light">("dark");

  const [toast, setToast] = useState<{ msg: string; tone: ToastTone; open: boolean }>({
    msg: "",
    tone: "info",
    open: false,
  });

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(true);

  const showToast = (msg: string, tone: ToastTone = "info") =>
    setToast({ msg, tone, open: true });

  // Prefill client name from the URL if we landed here from the audit page.
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
    return { total_one_time: oneTime, total_monthly: monthly };
  }, [selectedServices]);

  const proposalEmpty = useMemo(
    () => !Object.values(sections).some((s) => s.trim().length > 0),
    [sections]
  );

  function toggleService(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function preloadDefaults() {
    setSections(
      buildDefaultSections({
        client_name: clientName,
        business_type: businessType,
        website_url: websiteUrl,
        selected_services: selectedServices,
        totals,
        notes,
        audit: null,
      })
    );
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);

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
          // fall through
        }
        setError(msg);
        showToast(msg, "error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        // Update the editable sections live as the LLM streams in.
        const parsed = parseSectionsFromMarkdown(accumulated);
        setSections(parsed);
      }

      // After streaming, make sure every section has at least the default text.
      setSections((prev) => {
        const defaults = buildDefaultSections({
          client_name: clientName,
          business_type: businessType,
          website_url: websiteUrl,
          selected_services: selectedServices,
          totals,
          notes,
          audit: null,
        });
        const merged: ProposalSections = { ...prev };
        for (const key of Object.keys(defaults) as (keyof ProposalSections)[]) {
          if (!merged[key]?.trim()) merged[key] = defaults[key];
        }
        return merged;
      });

      loadProposals();
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy() {
    const text = sectionsToPlainText(sections);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast("Proposal text copied to clipboard", "success");
  }

  async function handleSave() {
    if (proposalEmpty) {
      showToast("Add some content before saving", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedId ?? undefined,
          client_name: clientName,
          business_type: businessType,
          website_url: websiteUrl,
          recipient_name: recipientName,
          recipient_email: recipientEmail,
          selected_services: selectedServices,
          proposal_sections: sections,
          proposal_html: sectionsToMarkdown(sections),
          lead_id: presetLeadId,
          audit_id: presetAuditId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.proposal?.id) setSavedId(data.proposal.id);
        showToast("Proposal saved", "success");
        loadProposals();
      } else {
        showToast("Failed to save proposal", "error");
      }
    } catch {
      showToast("Network error while saving", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    if (proposalEmpty) {
      showToast("Add some content before downloading", "error");
      return;
    }
    setDownloading(true);
    try {
      const { buildProposalPdf } = await import("@/lib/proposals/pdf");
      const doc = buildProposalPdf({
        sections,
        clientName,
        websiteUrl: websiteUrl || undefined,
      });
      doc.save(`tweak-and-build-proposal-${slugifyClient(clientName)}.pdf`);
      showToast("PDF downloaded", "success");
    } catch (err) {
      console.error(err);
      showToast("PDF generation failed", "error");
    } finally {
      setDownloading(false);
    }
  }

  async function handleSendEmail(
    payload: EmailProposalPayload
  ): Promise<{ ok: boolean; error?: string }> {
    let pdfBase64: string | undefined;
    if (payload.attachPdf) {
      try {
        const { buildProposalPdfBase64 } = await import("@/lib/proposals/pdf");
        pdfBase64 = buildProposalPdfBase64({
          sections,
          clientName,
          websiteUrl: websiteUrl || undefined,
        });
      } catch (err) {
        console.error("PDF generation for email failed:", err);
        return { ok: false, error: "Could not generate PDF attachment." };
      }
    }

    try {
      const res = await fetch("/api/proposals/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId: savedId ?? undefined,
          clientName,
          websiteUrl,
          recipientName: payload.recipientName,
          recipientEmail: payload.recipientEmail,
          subject: payload.subject,
          message: payload.message,
          proposalHtml: sectionsToMarkdown(sections),
          proposalSections: sections,
          attachPdf: payload.attachPdf,
          pdfBase64: payload.attachPdf ? pdfBase64 : undefined,
          selectedServices,
          totals,
          sendToOwnerOnly: payload.sendToOwnerOnly,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data?.error || "Failed to send email." };
      }
      if (data?.proposalId && !savedId) setSavedId(data.proposalId);

      if (payload.sendToOwnerOnly) {
        showToast(`Test email sent to ${data.recipient}`, "success");
      } else {
        showToast(`Proposal sent to ${payload.recipientEmail}`, "success");
        // Save recipient locally so the next save round-trips with it.
        setRecipientName(payload.recipientName);
        setRecipientEmail(payload.recipientEmail);
        loadProposals();
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error while sending." };
    }
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
    <div className="space-y-6 pb-24 lg:pb-6">
      <div>
        <DashboardHeader
          title="Proposal Generator"
          description="Build, edit, and send branded proposals"
        />
      </div>

      {/* Recent proposals */}
      <Card>
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

      <div className="grid gap-6 lg:grid-cols-5">
        {/* LEFT — form */}
        <div className="space-y-4 lg:col-span-2">
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
                  <span className="font-semibold">{moneyFmt(totals.total_one_time)}</span>
                  <span className="mx-2 text-zinc-700">|</span>
                  <span className="text-zinc-400">Monthly:</span>{" "}
                  <span className="font-semibold">{moneyFmt(totals.total_monthly)}/mo</span>
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

              <div className="flex flex-col gap-2">
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
                <Button variant="outline" onClick={preloadDefaults} disabled={generating}>
                  <Pencil className="h-4 w-4" />
                  Start with default draft
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Composer */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Pencil className="h-4 w-4 text-lime-400" />
                Edit Proposal Sections
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ProposalComposer
                sections={sections}
                onChange={setSections}
                disabled={generating}
              />
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — preview */}
        <div className="lg:col-span-3">
          <Card className="proposal-preview-card">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye className="h-5 w-5 text-lime-400" />
                  Preview
                </CardTitle>
                <div className="flex items-center gap-2">
                  {generating && (
                    <Badge variant="secondary" className="text-[10px]">
                      Streaming...
                    </Badge>
                  )}
                  <div className="inline-flex overflow-hidden rounded-md border border-zinc-800">
                    <button
                      onClick={() => setPreviewTheme("dark")}
                      className={`flex items-center gap-1 px-2.5 py-1 text-xs ${
                        previewTheme === "dark"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:bg-zinc-800/60"
                      }`}
                      aria-pressed={previewTheme === "dark"}
                    >
                      <Moon className="h-3 w-3" /> App
                    </button>
                    <button
                      onClick={() => setPreviewTheme("light")}
                      className={`flex items-center gap-1 px-2.5 py-1 text-xs ${
                        previewTheme === "light"
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-400 hover:bg-zinc-800/60"
                      }`}
                      aria-pressed={previewTheme === "light"}
                    >
                      <Sun className="h-3 w-3" /> Email/PDF
                    </button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-red-900 bg-red-950/40 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              <ProposalPreview
                sections={sections}
                clientName={clientName}
                websiteUrl={websiteUrl}
                theme={previewTheme}
              />

              {/* Desktop action bar */}
              <div className="hidden flex-wrap gap-2 lg:flex">
                <Button variant="outline" size="sm" onClick={handleCopy} disabled={proposalEmpty}>
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
                <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || proposalEmpty}>
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Proposal
                    </>
                  )}
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading || proposalEmpty}>
                  {downloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating PDF...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      Download PDF
                    </>
                  )}
                </Button>
                <Button size="sm" onClick={() => setEmailOpen(true)} disabled={proposalEmpty}>
                  <Mail className="h-4 w-4" />
                  Email Proposal
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sticky mobile action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={proposalEmpty}
            className="flex-1 px-2"
          >
            {copied ? <Check className="h-4 w-4 text-lime-400" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSave}
            disabled={saving || proposalEmpty}
            className="flex-1 px-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={downloading || proposalEmpty}
            className="flex-1 px-2"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </Button>
          <Button
            size="sm"
            onClick={() => setEmailOpen(true)}
            disabled={proposalEmpty}
            className="flex-[1.5] gap-1.5"
          >
            <Mail className="h-4 w-4" />
            Email
          </Button>
        </div>
      </div>

      <EmailProposalModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        defaultSubject={`Website + Local SEO Plan for ${clientName || "your business"}`}
        defaultMessage={DEFAULT_EMAIL_INTRO(clientName, recipientName)}
        defaultRecipientName={recipientName}
        defaultRecipientEmail={recipientEmail}
        onSend={handleSendEmail}
        proposalEmpty={proposalEmpty}
      />

      <Toast
        open={toast.open}
        message={toast.msg}
        tone={toast.tone}
        onDismiss={() => setToast((t) => ({ ...t, open: false }))}
      />
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
  const variant = STATUS_VARIANTS[proposal.status] ?? STATUS_VARIANTS.draft;
  const muted = MUTED_STATUSES.has(proposal.status);
  const isActive = proposal.status === "active";
  const rowClasses = [
    "text-sm transition-colors",
    muted ? "opacity-50 [&_td]:line-through [&_td]:decoration-zinc-700" : "",
    isActive ? "bg-lime-500/5" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <tr className={rowClasses}>
      <td className="px-3 py-2 text-zinc-100">
        <div className="flex items-center gap-2">
          {isActive && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-lime-400"
              aria-label="Active proposal"
            />
          )}
          <span>{proposal.client_name || "—"}</span>
        </div>
      </td>
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
