import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/guard";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { AgentImportForm } from "@/components/dashboard/agent-import-form";
import { ImportJobTable } from "@/components/dashboard/enrichment-job-table";
import type { ImportJob } from "@/lib/leads/types";

/**
 * /my/import — an agent imports leads they sourced themselves.
 *
 * Distinct from /leads/import, which is the admin bulk importer and stays
 * admin-only. Everything uploaded here is assigned to the caller and recorded
 * as a self_sourced attribution by public.import_agent_leads(); the agent has
 * no direct INSERT on `leads` and does not gain one.
 */
export default async function MyImportPage() {
  const guard = await requireUser();
  if (!guard.ok) redirect("/login");

  const supabase = await createClient();

  // The agent's own import history. Filtered on created_by because the
  // import_jobs policy lets any active profile read the table — this page is
  // about the caller's imports, not the team's.
  const { data } = await supabase
    .from("import_jobs")
    .select("*")
    .eq("created_by", guard.agent.id)
    .order("created_at", { ascending: false })
    .limit(25);

  return (
    <div className="space-y-6 sm:space-y-8">
      <DashboardHeader
        title="Import My Leads"
        description="Upload leads you sourced yourself. They are assigned to you on import."
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
        <AgentImportForm />
        <div>
          <h3 className="mb-3 text-base font-semibold text-zinc-50 sm:mb-4 sm:text-lg">
            My Import History
          </h3>
          <ImportJobTable jobs={(data ?? []) as ImportJob[]} />
        </div>
      </div>
    </div>
  );
}
