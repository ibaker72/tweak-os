import { createClient } from "@/lib/supabase/server";
import { getImportJobs } from "@/lib/leads/queries";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { ImportCsvForm } from "@/components/dashboard/import-csv-form";
import { ImportJobTable } from "@/components/dashboard/enrichment-job-table";

export default async function ImportsPage() {
  const supabase = await createClient();
  const jobs = await getImportJobs(supabase);

  return (
    <div className="space-y-6 sm:space-y-8">
      <DashboardHeader
        title="Import Leads"
        description="Upload a CSV file to import business leads"
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <ImportCsvForm />
        <div>
          <h3 className="mb-3 text-base font-semibold text-zinc-50 sm:mb-4 sm:text-lg">
            Import History
          </h3>
          <ImportJobTable jobs={jobs} />
        </div>
      </div>
    </div>
  );
}
