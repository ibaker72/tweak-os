"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AuditResultsPanel } from "./AuditResultsPanel";
import { SearchCheck, ArrowRight } from "lucide-react";
import type { LeadAudit } from "@/lib/audits/types";
import { formatDate } from "@/lib/utils";

interface LeadAuditTabProps {
  leadId: string;
  website: string | null;
  audit: LeadAudit | null;
}

export function LeadAuditTab({ leadId, website, audit }: LeadAuditTabProps) {
  if (audit && audit.audit_json) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <SearchCheck className="h-5 w-5 text-lime-400" />
              Audit
            </CardTitle>
            <p className="text-xs text-zinc-500">
              Run {formatDate(audit.created_at)}
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <AuditResultsPanel
            audit={audit.audit_json}
            url={audit.url}
            auditId={audit.id}
            leadId={leadId}
            showActions
          />
        </CardContent>
      </Card>
    );
  }

  const auditHref = website
    ? `/research?url=${encodeURIComponent(website)}&lead_id=${leadId}`
    : `/research?lead_id=${leadId}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <SearchCheck className="h-5 w-5 text-lime-400" />
          Audit
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <p className="text-sm text-zinc-400">No audit yet</p>
        <Link href={auditHref}>
          <Button size="sm">
            Run Audit
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        {!website && (
          <p className="text-xs text-zinc-600">
            No website URL on file — you can still enter one on the research page.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
