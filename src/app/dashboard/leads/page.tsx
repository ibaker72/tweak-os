import { createClient } from "@/lib/supabase/server";
import { getLeads } from "@/lib/leads/queries";
import { leadFilterSchema } from "@/lib/validators/lead";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { LeadsFilters } from "./leads-filters";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

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
        <Link href="/dashboard/imports">
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
        </Link>
      </DashboardHeader>

      <LeadsFilters currentFilters={rawParams} />

      <LeadsTable leads={leads} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map(
            (page) => (
              <Link
                key={page}
                href={{
                  pathname: "/dashboard/leads",
                  query: { ...rawParams, page: page.toString() },
                }}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  filters.page === page
                    ? "bg-zinc-50 text-zinc-900"
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
