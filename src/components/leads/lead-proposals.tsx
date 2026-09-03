import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Plus } from "lucide-react";
import { formatMoney } from "@/lib/proposals/services";
import { formatDate } from "@/lib/utils";
import type { Proposal } from "@/lib/proposals/types";

/**
 * Proposals on the lead page.
 *
 * Read-only and deliberately small: status, value, date, and a way in. The
 * "Create Proposal" link carries the lead id, which is what makes the resulting
 * proposal reference this lead instead of being matched to it by name later.
 */

export type LeadProposalRow = Pick<
  Proposal,
  "id" | "status" | "total_one_time" | "total_monthly" | "created_at"
> & { sent_at?: string | null };

export function LeadProposals({
  leadId,
  website,
  proposals,
}: {
  leadId: string;
  website?: string | null;
  proposals: LeadProposalRow[];
}) {
  const createHref = `/proposals?lead_id=${encodeURIComponent(leadId)}${
    website ? `&url=${encodeURIComponent(website)}` : ""
  }`;

  return (
    <Card>
      <CardHeader className="p-4 pb-0 sm:p-6 sm:pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-zinc-400">
            <FileText className="h-4 w-4 text-lime-400" />
            Proposals
            {proposals.length > 0 && (
              <span className="text-zinc-500">({proposals.length})</span>
            )}
          </CardTitle>
          <Link href={createHref}>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              Create Proposal
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        {proposals.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No proposals for this lead yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {proposals.map((proposal) => (
              <li
                key={proposal.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">
                    <span className="capitalize">{proposal.status}</span>
                    <span className="text-zinc-500">
                      {" · "}
                      {formatMoney(Number(proposal.total_one_time || 0))}
                      {Number(proposal.total_monthly || 0) > 0 &&
                        ` + ${formatMoney(Number(proposal.total_monthly || 0))}/mo`}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-500">
                    Created {formatDate(proposal.created_at)}
                    {proposal.sent_at ? ` · Sent ${formatDate(proposal.sent_at)}` : ""}
                  </p>
                </div>
                <Link
                  href={`/proposals?id=${proposal.id}`}
                  className="text-xs text-lime-400 transition-colors hover:text-lime-300"
                >
                  View proposal
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
