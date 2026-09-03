"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Search, Loader2, FileText, Users } from "lucide-react";
import { formatDate } from "@/lib/utils";
import {
  CANDIDATE_REASON_LABELS,
  LEAD_PICKER_LIMIT_DEFAULT,
  LEAD_SEARCH_MIN_LENGTH,
  type LeadCandidate,
} from "@/lib/proposals/lead-candidates";

/**
 * "Start from a Lead" — the CRM entry point to the Proposal Generator.
 *
 * Shows a short recommended list, not the leads table: the server returns
 * roughly eight candidates and searching goes back to the server rather than
 * filtering a downloaded copy of the CRM. Which leads come back is decided by
 * RLS, so an agent only ever sees their own.
 */

const FOCUS_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "follow_up_due", label: "Follow-up due" },
  { value: "engaged", label: "Responded" },
  { value: "hot", label: "Hot leads" },
] as const;

const SEARCH_DEBOUNCE_MS = 300;

interface LeadPickerProps {
  onSelect: (lead: LeadCandidate) => void;
  /** Highlights the row for the lead currently attached to the builder. */
  selectedLeadId?: string | null;
}

export function LeadPicker({ onSelect, selectedLeadId }: LeadPickerProps) {
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<string>("recommended");
  const [leads, setLeads] = useState<LeadCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow early response overwriting a newer one.
  const requestRef = useRef(0);

  const load = useCallback(async (search: string, focusValue: string) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        focus: focusValue,
        limit: String(LEAD_PICKER_LIMIT_DEFAULT),
      });
      if (search) params.set("q", search);

      const res = await fetch(`/api/proposals/leads?${params.toString()}`);
      if (requestId !== requestRef.current) return;
      if (!res.ok) {
        setLeads([]);
        setError("Could not load leads.");
        return;
      }
      const data = await res.json();
      setLeads(data.leads ?? []);
    } catch {
      if (requestId !== requestRef.current) return;
      setLeads([]);
      setError("Network error while loading leads.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(
      () => load(trimmed.length >= LEAD_SEARCH_MIN_LENGTH ? trimmed : "", focus),
      trimmed ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => clearTimeout(timer);
  }, [query, focus, load]);

  const searching = query.trim().length >= LEAD_SEARCH_MIN_LENGTH;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leads by business, contact, phone, email, city or website..."
            aria-label="Search leads"
          />
        </div>
        <Select
          className="sm:w-44"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          disabled={searching}
          aria-label="Lead filter"
        >
          {FOCUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 px-1 py-6 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading leads...
        </p>
      ) : error ? (
        <p className="px-1 py-6 text-sm text-red-300">{error}</p>
      ) : leads.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">
          {searching
            ? "No leads match that search."
            : "No lead candidates yet. You can still build a proposal manually below."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800/60 rounded-lg border border-zinc-800">
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              selected={lead.id === selectedLeadId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-zinc-500">
        <span>
          {searching
            ? `Showing ${leads.length} matching lead${leads.length === 1 ? "" : "s"}`
            : "Showing recommended leads"}
        </span>
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 text-lime-400 transition-colors hover:text-lime-300"
        >
          <Users className="h-3.5 w-3.5" />
          View all leads
        </Link>
      </div>
    </div>
  );
}

function LeadRow({
  lead,
  selected,
  onSelect,
}: {
  lead: LeadCandidate;
  selected: boolean;
  onSelect: (lead: LeadCandidate) => void;
}) {
  const location = [lead.city, lead.state].filter(Boolean).join(", ");
  const lastTouch = lead.next_action_date
    ? `Follow-up ${formatShortDate(lead.next_action_date)}`
    : lead.contacted_at
      ? `Contacted ${formatShortDate(lead.contacted_at)}`
      : null;

  return (
    <li
      className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${
        selected ? "bg-lime-500/5" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/leads/${lead.id}`}
            className="truncate text-sm font-medium text-zinc-100 transition-colors hover:text-lime-300"
          >
            {lead.business_name || "Untitled lead"}
          </Link>
          {lead.reason && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
              {CANDIDATE_REASON_LABELS[lead.reason]}
            </span>
          )}
          {typeof lead.score === "number" && lead.score > 0 && (
            <span className="text-[11px] font-semibold text-zinc-400">
              {lead.score}
            </span>
          )}
          {lead.proposal_count > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
              <FileText className="h-3 w-3" />
              {existingProposalLabel(lead)}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {[
            location || null,
            lead.website ? stripScheme(lead.website) : "No website",
            lead.assigned_to_name,
            lastTouch,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <Button
        size="sm"
        className="shrink-0 self-start sm:self-auto"
        onClick={() => onSelect(lead)}
      >
        Create Proposal
      </Button>
    </li>
  );
}

/** "1 existing proposal" / "Draft proposal from Sep 3" — enough to notice a duplicate. */
export function existingProposalLabel(lead: {
  proposal_count: number;
  latest_proposal: { status: string; created_at: string } | null;
}): string {
  if (lead.proposal_count <= 0) return "";
  if (lead.proposal_count === 1 && lead.latest_proposal) {
    const { status, created_at } = lead.latest_proposal;
    const when = formatShortDate(created_at);
    return when
      ? `${capitalize(status)} proposal from ${when}`
      : `${capitalize(status)} proposal`;
  }
  return `${lead.proposal_count} existing proposal${lead.proposal_count === 1 ? "" : "s"}`;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "";
  // next_action_date is a bare date. Reading it through Date() would treat it
  // as UTC midnight and shift it a day west of Greenwich, so format it as-is.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const source = dateOnly ? new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]) : value;
  const formatted = formatDate(source);
  if (formatted === "—") return "";
  // formatDate gives "Sep 3, 2026, 4:15 PM"; the picker only needs the day.
  return formatted.split(",")[0];
}
