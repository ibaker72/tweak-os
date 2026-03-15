import { createClient } from "@/lib/supabase/server";
import { getLeads } from "@/lib/leads/queries";
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
  const totalPages = Math.ceil(count / filters.per_page);

  return (
    <div className="space-y-6">
      <DashboardHeader title="Leads" description={`${count} total leads`}>
        <div className="flex items-center gap-2">
          <Link href="/leads/discover">
            <Button variant="outline" size="sm">
              <Compass className="h-4 w-4" />
              Discover
            </Button>
          </Link>
          <Link href="/leads/import">
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
          </Link>
          <a href="/api/exports">
            <Button variant="outline" size="sm">
              Export
            </Button>
          </a>
        </div>
      </DashboardHeader>

      <LeadsFilters currentFilters={rawParams} />

      <LeadsTable leads={leads} />

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(
            (page) => (
              <Link
                key={page}
                href={{
                  pathname: "/leads",
                  query: { ...rawParams, page: page.toString() },
                }}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  filters.page === page
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {page}
              </Link>
            )
          )}
        </div>
      )}
    </div>
  );
}
