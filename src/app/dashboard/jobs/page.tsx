import { createClient } from "@/lib/supabase/server";
import { getEnrichmentJobs, getImportJobs } from "@/lib/leads/queries";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import {
  EnrichmentJobTable,
  ImportJobTable,
} from "@/components/dashboard/enrichment-job-table";

export default async function JobsPage() {
  const supabase = await createClient();
  const [enrichmentJobs, importJobs] = await Promise.all([
    getEnrichmentJobs(supabase),
    getImportJobs(supabase),
  ]);

  return (
    <div className="space-y-8">
      <DashboardHeader
        title="Jobs"
        description="View enrichment and import job history"
      />

      <div className="space-y-8">
        <div>
          <h3 className="mb-4 text-lg font-semibold text-zinc-50">
            Import Jobs
          </h3>
          <ImportJobTable jobs={importJobs} />
        </div>

        <div>
          <h3 className="mb-4 text-lg font-semibold text-zinc-50">
            Enrichment Jobs
          </h3>
          <EnrichmentJobTable jobs={enrichmentJobs} />
        </div>
      </div>
    </div>
  );
}
