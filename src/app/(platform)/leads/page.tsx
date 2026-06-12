import { createClient } from "@/lib/supabase/server";
import { getLeads } from "@/lib/leads/queries";
import { getLatestAuditsByLeadIds, type LeadAuditSummary } from "@/lib/audits/queries";
import { leadFilterSchema } from "@/lib/validators/lead";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { LeadsFilters } from "./leads-filters";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Upload, Compass } from "lucide-react";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") rawParams[key] = value;
  }

  const filters = leadFilterSchema.parse(rawParams);
  const supabase = await createClient();
  const { data: leads, count } = await getLeads(supabase, filters);
  const totalPages = Math.max(1, Math.ceil(count / filters.per_page));
  const currentPage = Math.min(filters.page, totalPages);

  // Display range: "Showing X–Y of Z"
  const rangeStart = count === 0 ? 0 : (currentPage - 1) * filters.per_page + 1;
  const rangeEnd = Math.min(count, currentPage * filters.per_page);

  let agents: { id: string; display_name: string }[] = [];
  try {
    const { data } = await supabase
      .from("agent_profiles")
      .select("id, display_name")
      .eq("is_active", true)
      .order("display_name");
    agents = data ?? [];
  } catch {
    agents = [];
  }

  // Fetch latest audit per lead so we can render the Opp Score column.
  let auditsByLeadId = new Map<string, LeadAuditSummary>();
  try {
    auditsByLeadId = await getLatestAuditsByLeadIds(
      supabase,
      leads.map((l) => l.id)
    );
  } catch {
    // Best-effort — table simply omits Opp Score badges on failure.
  }
  const auditsRecord: Record<
    string,
    { id: string; opportunity_grade: string | null; overall_score: number | null }
  > = {};
  for (const [leadId, summary] of auditsByLeadId) {
    auditsRecord[leadId] = {
      id: summary.id,
      opportunity_grade: summary.opportunity_grade,
      overall_score: summary.overall_score,
    };
  }

  // Build a paginator window of up to 7 pages around the current page.
  const windowSize = 7;
  const windowStart = Math.max(1, currentPage - Math.floor(windowSize / 2));
  const windowEnd = Math.min(totalPages, windowStart + windowSize - 1);
  const pages: number[] = [];
  for (let p = windowStart; p <= windowEnd; p++) pages.push(p);

  return (
    <div className="space-y-6">
      <DashboardHeader title="Leads" description={`${count.toLocaleString()} total leads`}>
        <Link href="/leads/discover" className="w-full sm:w-auto">
          <Button variant="outline" size="sm" className="w-full sm:w-auto">
            <Compass className="h-4 w-4" />
            Discover
          </Button>
        </Link>
        <Link href="/leads/import" className="w-full sm:w-auto">
          <Button variant="outline" size="sm" className="w-full sm:w-auto">
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
        </Link>
        <a href="/api/exports" className="w-full sm:w-auto">
          <Button variant="outline" size="sm" className="w-full sm:w-auto">
            Export
          </Button>
        </a>
      </DashboardHeader>

      <LeadsFilters currentFilters={rawParams} />

      <LeadsTable
        leads={leads}
        agents={agents}
        auditsByLeadId={auditsRecord}
        view={filters.view}
      />

      <div className="flex flex-col items-center justify-between gap-3 pt-2 sm:flex-row">
        <p className="text-xs text-zinc-500">
          {count === 0
            ? "No results"
            : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${count.toLocaleString()}`}
        </p>

        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {currentPage > 1 && (
              <Link
                href={{
                  pathname: "/leads",
                  query: { ...rawParams, page: String(currentPage - 1) },
                }}
                className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                ← Prev
              </Link>
            )}
            {pages.map((page) => (
              <Link
                key={page}
                href={{
                  pathname: "/leads",
                  query: { ...rawParams, page: String(page) },
                }}
                className={`rounded-md px-3 py-1 text-xs transition-colors ${
                  currentPage === page
                    ? "border border-lime-400/30 bg-lime-400/10 text-lime-400"
                    : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {page}
              </Link>
            ))}
            {currentPage < totalPages && (
              <Link
                href={{
                  pathname: "/leads",
                  query: { ...rawParams, page: String(currentPage + 1) },
                }}
                className="rounded-md px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Next →
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
