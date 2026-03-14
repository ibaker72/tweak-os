import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { ExportButton } from "@/components/dashboard/export-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download } from "lucide-react";

export default function ExportsPage() {
  return (
    <div className="space-y-8">
      <DashboardHeader
        title="Export"
        description="Download your leads as CSV"
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-zinc-400" />
              All Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-zinc-400">
              Export all leads with enrichment data, scores, and insights.
            </p>
            <ExportButton />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-emerald-500" />
              High-Score Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-zinc-400">
              Export only leads with a score of 60 or higher.
            </p>
            <ExportButton filters={{ min_score: "60", sort_by: "score", sort_order: "desc" }} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Download className="h-5 w-5 text-blue-500" />
              Enriched Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-zinc-400">
              Export only leads that have been successfully enriched.
            </p>
            <ExportButton filters={{ enrichment_status: "completed" }} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
