"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead, LifecycleStatus, ActivityLogEntry } from "@/lib/leads/types";
import { getScoreColor, getScoreBgColor } from "@/lib/leads/scoring";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  LifecycleStatusBadge,
  EnrichmentStatusBadge,
} from "./lead-status-badge";
import {
  Globe,
  Mail,
  Phone,
  ExternalLink,
  RefreshCw,
  Save,
  Copy,
  Check,
  Zap,
  Shield,
  Smartphone,
  Clock,
  ShoppingCart,
  BookOpen,
  Star,
  MessageSquare,
  FileText,
  ChevronDown,
  X,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import {
  OUTREACH_TEMPLATES,
  fillTemplate,
  type OutreachTemplate,
  type TemplateVariables,
} from "@/lib/leads/outreach-templates";

const LIFECYCLE_OPTIONS: LifecycleStatus[] = [
  "new",
  "enriched",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
  "not_a_fit",
];

export function LeadDetailCard({
  lead,
  activityLog = [],
}: {
  lead: Lead;
  activityLog?: ActivityLogEntry[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState(lead.lifecycle_status);
  const [notes, setNotes] = useState(lead.manual_notes ?? "");
  const [manualScore, setManualScore] = useState(String(lead.score));
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [generatingOutreach, setGeneratingOutreach] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<{ subject?: string; body: string } | null>(null);
  const [templateName, setTemplateName] = useState("");

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: lead.id,
          lifecycle_status: status,
          manual_notes: notes,
          score: parseInt(manualScore) || lead.score,
        }),
      });
      router.refresh();
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleEnrich() {
    setEnriching(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch (err) {
      console.error("Enrich error:", err);
    } finally {
      setEnriching(false);
    }
  }

  async function handleGenerateOutreach() {
    setGeneratingOutreach(true);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch (err) {
      console.error("Outreach error:", err);
    } finally {
      setGeneratingOutreach(false);
    }
  }

  async function handleMarkContacted() {
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: lead.id,
        lifecycle_status: "contacted",
      }),
    });
    router.refresh();
  }

  function handleSelectTemplate(template: OutreachTemplate) {
    const loadTime = lead.page_load_time_ms ? (lead.page_load_time_ms / 1000).toFixed(1) : "unknown";
    const lostPercent = lead.page_load_time_ms
      ? lead.page_load_time_ms > 5000 ? "53" : lead.page_load_time_ms > 3000 ? "32" : "10"
      : "unknown";
    const missingItems = [
      !lead.has_ssl ? "SSL certificate" : null,
      !lead.is_mobile_responsive ? "mobile optimization" : null,
      !lead.has_blog ? "blog/content" : null,
    ].filter(Boolean).join(", ") || "none detected";

    const vars: TemplateVariables = {
      business_name: lead.business_name,
      platform: lead.tech_stack?.[0] ?? "their current platform",
      niche: lead.niche || lead.category || "local",
      metric: "a 40% increase in conversions",
      load_time: loadTime,
      lost_percent: lostPercent,
      performance_grade: lead.performance_grade || "N/A",
      mobile_status: lead.is_mobile_responsive ? "Responsive" : "Not mobile-friendly",
      missing_items: missingItems,
    };

    const filled = fillTemplate(template, vars);
    setSelectedTemplate(filled);
    setTemplateName(template.name);
    setShowTemplateMenu(false);
  }

  async function handleSendTemplate() {
    if (!selectedTemplate) return;
    const fullText = selectedTemplate.subject
      ? `Subject: ${selectedTemplate.subject}\n\n${selectedTemplate.body}`
      : selectedTemplate.body;
    navigator.clipboard.writeText(fullText);
    setCopiedField("template");
    setTimeout(() => setCopiedField(null), 2000);
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: lead.id,
        lifecycle_status: "contacted",
      }),
    });
    router.refresh();
    setSelectedTemplate(null);
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  const outreach = lead.outreach;
  const scoreBreakdown = lead.score_breakdown || {};

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Business Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Business Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <InfoRow label="Business Name" value={lead.business_name} />
          <InfoRow
            label="Location"
            value={
              [lead.address || [lead.city, lead.state].filter(Boolean).join(", ")].filter(Boolean).join("") || "—"
            }
          />
          <InfoRow label="Industry" value={lead.niche || lead.category || "—"} />
          <InfoRow label="Source" value={lead.source || "—"} />

          {lead.website && (
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-zinc-500" />
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:underline"
              >
                {lead.website}
                <ExternalLink className="ml-1 inline h-3 w-3" />
              </a>
            </div>
          )}

          {lead.google_rating && (
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-zinc-300">
                {lead.google_rating}/5 ({lead.google_review_count || 0} reviews)
              </span>
            </div>
          )}

          {lead.page_title && (
            <InfoRow label="Page Title" value={lead.page_title} />
          )}

          {/* Tech Stack */}
          {lead.tech_stack && lead.tech_stack.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase text-zinc-500 mb-2">Tech Stack</p>
              <div className="flex flex-wrap gap-1.5">
                {lead.tech_stack.map((tech) => (
                  <Badge key={tech} variant="secondary">{tech}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Tech Signals */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <TechSignal
              icon={Shield}
              label="SSL"
              value={lead.has_ssl}
              positive={true}
            />
            <TechSignal
              icon={Smartphone}
              label="Mobile"
              value={lead.is_mobile_responsive}
              positive={true}
            />
            <TechSignal
              icon={BookOpen}
              label="Blog"
              value={lead.has_blog}
              positive={false}
            />
            <TechSignal
              icon={ShoppingCart}
              label="E-commerce"
              value={lead.has_ecommerce}
              positive={true}
            />
          </div>

          {lead.page_load_time_ms && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-zinc-500" />
              <span className={`text-sm ${lead.page_load_time_ms > 3000 ? "text-red-400" : "text-emerald-400"}`}>
                {(lead.page_load_time_ms / 1000).toFixed(1)}s load time
              </span>
              {lead.performance_grade && (
                <Badge
                  variant="secondary"
                  className={
                    lead.performance_grade === "A"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : lead.performance_grade === "B"
                        ? "bg-blue-500/10 text-blue-400"
                        : lead.performance_grade === "C"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-red-500/10 text-red-400"
                  }
                >
                  Grade {lead.performance_grade}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Contact Info</CardTitle>
            <EnrichmentStatusBadge status={lead.enrichment_status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {(lead.email || lead.email_1) && (
            <ContactRow
              icon={Mail}
              value={lead.email || lead.email_1 || ""}
              onCopy={() => copyToClipboard(lead.email || lead.email_1 || "", "email")}
              copied={copiedField === "email"}
            />
          )}
          {lead.email_2 && (
            <ContactRow
              icon={Mail}
              value={lead.email_2}
              onCopy={() => copyToClipboard(lead.email_2!, "email2")}
              copied={copiedField === "email2"}
            />
          )}
          {(lead.phone || lead.phone_1) && (
            <ContactRow
              icon={Phone}
              value={lead.phone || lead.phone_1 || ""}
              onCopy={() => copyToClipboard(lead.phone || lead.phone_1 || "", "phone")}
              copied={copiedField === "phone"}
            />
          )}

          {lead.contact_page && (
            <a
              href={lead.contact_page}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:underline"
            >
              Contact Page <ExternalLink className="ml-1 inline h-3 w-3" />
            </a>
          )}

          {/* Social Links */}
          <div className="flex flex-wrap gap-2 pt-2">
            {(lead.social_links?.facebook || lead.facebook) && (
              <SocialBadge href={lead.social_links?.facebook || lead.facebook || ""} label="Facebook" />
            )}
            {(lead.social_links?.instagram || lead.instagram) && (
              <SocialBadge href={lead.social_links?.instagram || lead.instagram || ""} label="Instagram" />
            )}
            {(lead.social_links?.linkedin || lead.linkedin) && (
              <SocialBadge href={lead.social_links?.linkedin || lead.linkedin || ""} label="LinkedIn" />
            )}
            {(lead.social_links?.twitter || lead.twitter) && (
              <SocialBadge href={lead.social_links?.twitter || lead.twitter || ""} label="X / Twitter" />
            )}
          </div>

          {!lead.email && !lead.email_1 && !lead.phone && !lead.phone_1 && lead.enrichment_status !== "complete" && (
            <p className="text-sm text-zinc-500">
              No contact info yet. Run enrichment to find contacts.
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEnrich}
              disabled={enriching || !lead.website}
            >
              <RefreshCw className={`h-4 w-4 ${enriching ? "animate-spin" : ""}`} />
              {enriching ? "Enriching..." : "Run Enrichment"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkContacted}
            >
              <MessageSquare className="h-4 w-4" />
              Mark Contacted
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Score Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Score:{" "}
            <span className={getScoreColor(lead.score)}>
              {lead.score}/100
            </span>
            <span className="ml-2 text-sm font-normal text-zinc-500">
              {lead.score >= 70 ? "HOT" : lead.score >= 40 ? "WARM" : "COLD"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Score breakdown by factor */}
          {Object.keys(scoreBreakdown).length > 0 && (
            <div className="space-y-2">
              {Object.entries(scoreBreakdown).map(([factor, points]) => (
                <div key={factor} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">{factor}</span>
                  <span className={`text-sm font-mono font-bold ${Number(points) > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {Number(points) > 0 ? "+" : ""}{points}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Detailed reasons */}
          {lead.reasons && lead.reasons.length > 0 && (
            <div className="space-y-1 border-t border-zinc-800 pt-3">
              {lead.reasons.map((reason, i) => (
                <p key={i} className="text-xs text-zinc-500">{reason}</p>
              ))}
            </div>
          )}

          {!Object.keys(scoreBreakdown).length && (!lead.reasons || lead.reasons.length === 0) && (
            <p className="text-sm text-zinc-500">
              No scoring data. Run enrichment first.
            </p>
          )}

          {/* Manual score adjustment */}
          <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
            <label className="text-xs text-zinc-500">Manual adjust:</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={manualScore}
              onChange={(e) => setManualScore(e.target.value)}
              className="w-20 text-center"
            />
          </div>
        </CardContent>
      </Card>

      {/* AI Outreach */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Zap className="h-5 w-5 text-emerald-500" />
              Outreach
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTemplateMenu(!showTemplateMenu)}
                >
                  <FileText className="h-4 w-4" />
                  Templates
                  <ChevronDown className="h-3 w-3" />
                </Button>
                {showTemplateMenu && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
                    {OUTREACH_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTemplate(t)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                      >
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {t.channel}
                        </Badge>
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateOutreach}
                disabled={generatingOutreach}
              >
                <Zap className={`h-4 w-4 ${generatingOutreach ? "animate-pulse" : ""}`} />
                {generatingOutreach ? "Generating..." : "Generate AI Outreach"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {outreach ? (
            <>
              {/* Pain Points */}
              {outreach.pain_points && outreach.pain_points.length > 0 && (
                <OutreachSection title="Pain Points">
                  <ul className="space-y-1">
                    {outreach.pain_points.map((point, i) => (
                      <li key={i} className="text-sm text-zinc-300 flex items-start gap-2">
                        <span className="text-red-400 mt-0.5">•</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </OutreachSection>
              )}

              {/* Offer Angle */}
              {outreach.offer_angle && (
                <OutreachSection title="Offer Angle">
                  <p className="text-sm text-zinc-300">{outreach.offer_angle}</p>
                  {outreach.pricing_tier && (
                    <Badge variant="success" className="mt-1">{outreach.pricing_tier}</Badge>
                  )}
                </OutreachSection>
              )}

              {/* Cold Email */}
              {outreach.cold_email && (
                <CopyableSection
                  title="Cold Email"
                  content={outreach.cold_email}
                  onCopy={() => copyToClipboard(outreach.cold_email || "", "cold_email")}
                  copied={copiedField === "cold_email"}
                />
              )}

              {/* LinkedIn DM */}
              {outreach.linkedin_dm && (
                <CopyableSection
                  title="LinkedIn DM"
                  content={outreach.linkedin_dm}
                  onCopy={() => copyToClipboard(outreach.linkedin_dm || "", "linkedin_dm")}
                  copied={copiedField === "linkedin_dm"}
                />
              )}

              {/* Follow-up Email */}
              {outreach.follow_up_email && (
                <CopyableSection
                  title="Follow-up Email (5 days later)"
                  content={outreach.follow_up_email}
                  onCopy={() => copyToClipboard(outreach.follow_up_email || "", "follow_up")}
                  copied={copiedField === "follow_up"}
                />
              )}
            </>
          ) : (
            <>
              {/* Legacy insights */}
              {lead.pain_point_1 ? (
                <div className="space-y-3">
                  <OutreachSection title="Pain Points">
                    <p className="text-sm text-zinc-300">{lead.pain_point_1}</p>
                    {lead.pain_point_2 && (
                      <p className="text-sm text-zinc-300">{lead.pain_point_2}</p>
                    )}
                  </OutreachSection>
                  {lead.offer_angle && (
                    <OutreachSection title="Offer Angle">
                      <p className="text-sm text-zinc-300">{lead.offer_angle}</p>
                    </OutreachSection>
                  )}
                  {lead.suggested_first_line && (
                    <CopyableSection
                      title="Suggested First Line"
                      content={lead.suggested_first_line}
                      onCopy={() => copyToClipboard(lead.suggested_first_line || "", "first_line")}
                      copied={copiedField === "first_line"}
                    />
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  Run enrichment or click "Generate AI Outreach" to create personalized outreach.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Status & Notes */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">Status & Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-zinc-400">
              Lifecycle Status
            </label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as LifecycleStatus)}
              className="w-48"
            >
              {LIFECYCLE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                </option>
              ))}
            </Select>
            <LifecycleStatusBadge status={status} />
            {lead.contacted_at && (
              <span className="text-xs text-zinc-500">
                Contacted: {formatDate(lead.contacted_at)}
              </span>
            )}
          </div>

          <div>
            <label className="text-sm font-medium text-zinc-400">Notes</label>
            <Textarea
              className="mt-2"
              rows={4}
              placeholder="Add notes about this lead..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Activity Log */}
      {activityLog.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Activity Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {activityLog.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between border-b border-zinc-800/50 py-2 last:border-0"
                >
                  <div>
                    <span className="text-sm text-zinc-300 capitalize">
                      {entry.action.replace(/_/g, " ")}
                    </span>
                    {entry.details && (
                      <span className="text-xs text-zinc-500 ml-2">
                        {JSON.stringify(entry.details).slice(0, 80)}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">
                    {formatDate(entry.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Template Preview Dialog */}
      {selectedTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <h3 className="text-base font-medium text-zinc-100">{templateName}</h3>
              <button onClick={() => setSelectedTemplate(null)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {selectedTemplate.subject && (
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500 mb-1">Subject</p>
                  <p className="text-sm text-zinc-200">{selectedTemplate.subject}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500 mb-1">Body</p>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{selectedTemplate.body}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const fullText = selectedTemplate.subject
                    ? `Subject: ${selectedTemplate.subject}\n\n${selectedTemplate.body}`
                    : selectedTemplate.body;
                  navigator.clipboard.writeText(fullText);
                  setCopiedField("template");
                  setTimeout(() => setCopiedField(null), 2000);
                }}
              >
                {copiedField === "template" ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
              <Button size="sm" onClick={handleSendTemplate}>
                <MessageSquare className="h-4 w-4" />
                Send & Mark Contacted
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-300">{value}</p>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  value,
  onCopy,
  copied,
}: {
  icon: typeof Mail;
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center justify-between group">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-zinc-500" />
        <span className="text-sm text-zinc-300">{value}</span>
      </div>
      <button
        onClick={onCopy}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-zinc-500 hover:text-zinc-300" />
        )}
      </button>
    </div>
  );
}

function SocialBadge({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      <Badge variant="secondary" className="hover:bg-zinc-700 transition-colors">
        {label}
      </Badge>
    </a>
  );
}

function TechSignal({
  icon: Icon,
  label,
  value,
  positive,
}: {
  icon: typeof Shield;
  label: string;
  value: boolean | null;
  positive: boolean;
}) {
  if (value === null || value === undefined) return null;

  const isGood = positive ? value : !value;

  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-3.5 w-3.5 ${isGood ? "text-emerald-500" : "text-red-400"}`} />
      <span className={`text-xs ${isGood ? "text-emerald-400" : "text-red-400"}`}>
        {value ? `Has ${label}` : `No ${label}`}
      </span>
    </div>
  );
}

function OutreachSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-zinc-500 mb-1">{title}</p>
      {children}
    </div>
  );
}

function CopyableSection({
  title,
  content,
  onCopy,
  copied,
}: {
  title: string;
  content: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium uppercase text-zinc-500">{title}</p>
        <button
          onClick={onCopy}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
      <p className="text-sm text-zinc-300 whitespace-pre-wrap">{content}</p>
    </div>
  );
}
