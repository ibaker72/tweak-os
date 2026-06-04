"use client";

import Link from "next/link";
import type { AuditJson } from "@/lib/audits/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AuditScoreCard } from "./AuditScoreCard";
import { OpportunityGradeBadge } from "./OpportunityGradeBadge";
import {
  FileText,
  Code,
  MapPin,
  Swords,
  ArrowRight,
  RefreshCw,
  Link as LinkIcon,
} from "lucide-react";

export interface AuditResultsPanelProps {
  audit: AuditJson;
  url?: string;
  auditId?: string;
  leadId?: string | null;
  onAttachToLead?: () => void;
  onRunNew?: () => void;
  showActions?: boolean;
}

function FindingsCard({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: typeof FileText;
  items: string[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-zinc-400">
          <Icon className="h-4 w-4 text-lime-400" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-lime-400">None detected ✓</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-zinc-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AuditResultsPanel({
  audit,
  url,
  auditId,
  leadId,
  onAttachToLead,
  onRunNew,
  showActions = true,
}: AuditResultsPanelProps) {
  const proposalParams = new URLSearchParams();
  if (url) proposalParams.set("url", url);
  if (leadId) proposalParams.set("lead_id", leadId);
  if (auditId) proposalParams.set("audit_id", auditId);
  const proposalHref = `/proposals${proposalParams.toString() ? `?${proposalParams.toString()}` : ""}`;

  return (
    <div className="space-y-5">
      {/* Row 1 — Score cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <AuditScoreCard label="Overall" score={audit.overall_score} />
        <AuditScoreCard label="SEO" score={audit.seo_score} />
        <AuditScoreCard label="Speed" score={audit.speed_score} />
        <AuditScoreCard label="Mobile" score={audit.mobile_score} />
        <AuditScoreCard label="Conversion" score={audit.conversion_score} />
      </div>

      {/* Row 2 — Opportunity grade */}
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-4 py-6">
          <OpportunityGradeBadge
            grade={audit.opportunity_grade}
            estimatedLeadsLost={audit.estimated_monthly_leads_lost}
            size="lg"
            showLabel
          />
          {audit.summary && (
            <p className="max-w-2xl text-center text-sm text-zinc-300">
              {audit.summary}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Row 3 — Findings */}
      <div className="grid gap-4 sm:grid-cols-2">
        <FindingsCard title="Missing Pages" icon={FileText} items={audit.missing_pages} />
        <FindingsCard title="Missing Schema" icon={Code} items={audit.missing_schema} />
        <FindingsCard title="GBP Issues" icon={MapPin} items={audit.gbp_issues} />
        <FindingsCard title="Competitor Gaps" icon={Swords} items={audit.competitor_gaps} />
      </div>

      {/* Row 4 — Top recommendations */}
      <Card className="border-l-4 border-l-lime-400">
        <CardHeader>
          <CardTitle className="text-base text-zinc-100">Top 3 Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          {audit.top_3_recommendations.length === 0 ? (
            <p className="text-sm text-zinc-500">No recommendations generated.</p>
          ) : (
            <ol className="space-y-3">
              {audit.top_3_recommendations.map((rec, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-lime-400 text-xs font-bold text-zinc-950">
                    {i + 1}
                  </span>
                  <p className="text-sm text-zinc-200">{rec}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Row 5 — Actions */}
      {showActions && (
        <div className="flex flex-wrap gap-2">
          <Link href={proposalHref}>
            <Button>
              Generate Proposal
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          {!leadId && onAttachToLead && (
            <Button variant="outline" onClick={onAttachToLead}>
              <LinkIcon className="h-4 w-4" />
              Attach to Lead
            </Button>
          )}
          {onRunNew && (
            <Button variant="outline" onClick={onRunNew}>
              <RefreshCw className="h-4 w-4" />
              Run New Audit
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
