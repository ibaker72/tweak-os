"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Lead, LifecycleStatus } from "@/lib/leads/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";

const LIFECYCLE_OPTIONS: LifecycleStatus[] = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
  "archived",
];

export function LeadDetailCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const [status, setStatus] = useState(lead.lifecycle_status);
  const [notes, setNotes] = useState(lead.manual_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);

  async function handleSaveStatus() {
    setSaving(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await supabase
        .from("leads")
        .update({ lifecycle_status: status, manual_notes: notes })
        .eq("id", lead.id);
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
              [lead.city, lead.state].filter(Boolean).join(", ") || "—"
            }
          />
          <InfoRow label="Source" value={lead.source || "—"} />
          <InfoRow label="Niche" value={lead.niche || "—"} />
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
          {lead.page_title && (
            <InfoRow label="Page Title" value={lead.page_title} />
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
          {lead.email_1 && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-zinc-500" />
              <span className="text-sm text-zinc-300">{lead.email_1}</span>
            </div>
          )}
          {lead.email_2 && (
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-zinc-500" />
              <span className="text-sm text-zinc-300">{lead.email_2}</span>
            </div>
          )}
          {lead.phone_1 && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-zinc-500" />
              <span className="text-sm text-zinc-300">{lead.phone_1}</span>
            </div>
          )}
          {lead.phone_2 && (
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-zinc-500" />
              <span className="text-sm text-zinc-300">{lead.phone_2}</span>
            </div>
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
            {lead.facebook && (
              <a href={lead.facebook} target="_blank" rel="noopener noreferrer">
                <Badge variant="secondary">Facebook</Badge>
              </a>
            )}
            {lead.instagram && (
              <a href={lead.instagram} target="_blank" rel="noopener noreferrer">
                <Badge variant="secondary">Instagram</Badge>
              </a>
            )}
            {lead.linkedin && (
              <a href={lead.linkedin} target="_blank" rel="noopener noreferrer">
                <Badge variant="secondary">LinkedIn</Badge>
              </a>
            )}
          </div>

          {!lead.email_1 &&
            !lead.phone_1 &&
            lead.enrichment_status !== "completed" && (
              <p className="text-sm text-zinc-500">
                No contact info yet. Run enrichment to find contacts.
              </p>
            )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleEnrich}
            disabled={enriching || !lead.website}
            className="mt-3"
          >
            <RefreshCw
              className={`h-4 w-4 ${enriching ? "animate-spin" : ""}`}
            />
            {enriching ? "Enriching..." : "Run Enrichment"}
          </Button>
        </CardContent>
      </Card>

      {/* Score & Reasons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Score:{" "}
            <span
              className={
                lead.score >= 70
                  ? "text-emerald-400"
                  : lead.score >= 40
                    ? "text-amber-400"
                    : "text-red-400"
              }
            >
              {lead.score}/100
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lead.reasons && lead.reasons.length > 0 ? (
            <ul className="space-y-1">
              {lead.reasons.map((reason, i) => (
                <li key={i} className="text-sm text-zinc-400">
                  {reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">
              No scoring data. Run enrichment first.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Outreach Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Outreach Insights</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lead.pain_point_1 ? (
            <>
              <InsightRow label="Pain Point 1" value={lead.pain_point_1} />
              <InsightRow label="Pain Point 2" value={lead.pain_point_2} />
              <InsightRow label="Offer Angle" value={lead.offer_angle} />
              <InsightRow
                label="Suggested First Line"
                value={lead.suggested_first_line}
              />
            </>
          ) : (
            <p className="text-sm text-zinc-500">
              Run enrichment to generate outreach insights.
            </p>
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
              onChange={(e) =>
                setStatus(e.target.value as LifecycleStatus)
              }
              className="w-48"
            >
              {LIFECYCLE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </Select>
            <LifecycleStatusBadge status={status} />
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

          <Button onClick={handleSaveStatus} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>
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

function InsightRow({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-300">{value}</p>
    </div>
  );
}
