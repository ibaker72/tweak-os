"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  AlertTriangle,
  SearchCheck,
  Globe,
  Sparkles,
} from "lucide-react";
import { LeadPicker, type LeadOption } from "@/components/audit/LeadPicker";
import { AuditResultsPanel } from "@/components/audit/AuditResultsPanel";
import type { AuditJson } from "@/lib/audits/types";

interface AuditRunResponse {
  success: boolean;
  audit: AuditJson;
  record: {
    id: string;
    url: string;
    audit_json: AuditJson | null;
    opportunity_grade: string | null;
    overall_score: number | null;
    lead_id: string | null;
    created_at: string;
  } | null;
}

function ResearchPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialUrl = params.get("url") ?? "";
  const initialLeadId = params.get("lead_id");

  const [url, setUrl] = useState(initialUrl);
  const [leadId, setLeadId] = useState<string | null>(initialLeadId);
  const [selectedLead, setSelectedLead] = useState<LeadOption | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditJson | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  // If lead_id is preselected via query string but we don't have the lead row,
  // try to fetch it for display purposes (best-effort).
  useEffect(() => {
    if (!initialLeadId) return;
    let cancelled = false;
    fetch(`/api/leads/list?per_page=500`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.leads) return;
        const match = (data.leads as LeadOption[]).find(
          (l) => l.id === initialLeadId
        );
        if (match) {
          setSelectedLead(match);
          if (!url && match.website) setUrl(match.website);
        }
      })
      .catch(() => {
        // Silent failure — picker will load fresh on its own.
      });
    return () => {
      cancelled = true;
    };
    // We only want to run this on mount with the URL-supplied lead id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLeadId]);

  async function handleRunAudit() {
    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }
    setRunning(true);
    setError(null);
    setAudit(null);
    setAuditId(null);

    try {
      const res = await fetch("/api/audit/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          lead_id: leadId ?? undefined,
        }),
      });
      const data = (await res.json()) as AuditRunResponse | { error?: string };
      if (!res.ok || !("audit" in data) || !data.audit) {
        const msg =
          ("error" in data && data.error) || "Failed to run audit";
        setError(msg);
        return;
      }
      setAudit(data.audit);
      setAuditId(data.record?.id ?? null);
      setResolvedUrl(data.record?.url ?? url.trim());
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setRunning(false);
    }
  }

  function handleReset() {
    setUrl("");
    setLeadId(null);
    setSelectedLead(null);
    setAudit(null);
    setAuditId(null);
    setError(null);
    setResolvedUrl(null);
    router.replace("/research");
  }

  async function handleAttachToLead() {
    if (!auditId || !leadId) return;
    try {
      await fetch("/api/audit/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audit_id: auditId, lead_id: leadId }),
      });
    } catch {
      // Failure surfaces via subsequent navigation/refresh — silent here.
    }
  }

  return (
    <div className="space-y-6">
      <DashboardHeader
        title="Lead Research"
        description="Run an instant audit on any business website"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SearchCheck className="h-5 w-5 text-lime-400" />
            New Audit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              <Globe className="mr-1 inline h-3 w-3" />
              Website URL
            </label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="mt-1.5"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !running) handleRunAudit();
              }}
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Attach to lead (optional)
            </label>
            <div className="mt-1.5">
              <LeadPicker
                value={leadId}
                onChange={(id, opt) => {
                  setLeadId(id);
                  setSelectedLead(opt);
                  if (opt?.website && !url) setUrl(opt.website);
                }}
              />
            </div>
            {selectedLead && (
              <p className="mt-1.5 text-xs text-zinc-500">
                Auditing for <span className="text-zinc-300">{selectedLead.business_name}</span>
              </p>
            )}
          </div>

          <Button
            onClick={handleRunAudit}
            disabled={running || !url.trim()}
            className="w-full sm:w-auto"
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing website...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Run Audit
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-900 bg-red-950/30">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <p className="text-sm text-red-300">{error}</p>
          </CardContent>
        </Card>
      )}

      {running && !audit && <LoadingSkeleton />}

      {audit && (
        <AuditResultsPanel
          audit={audit}
          url={resolvedUrl ?? url}
          auditId={auditId ?? undefined}
          leadId={leadId ?? undefined}
          onAttachToLead={
            !leadId
              ? undefined
              : handleAttachToLead /* unreachable — disabled when leadId set */
          }
          onRunNew={handleReset}
        />
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <div className="h-16 w-16 animate-pulse rounded-full bg-zinc-800" />
            <div className="h-3 w-16 animate-pulse rounded bg-zinc-800" />
          </div>
        ))}
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10">
          <div className="h-24 w-32 animate-pulse rounded-xl bg-zinc-800" />
          <p className="text-sm text-zinc-500">Analyzing website...</p>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
          >
            <div className="h-3 w-32 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-full animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ResearchPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ResearchPageInner />
    </Suspense>
  );
}
