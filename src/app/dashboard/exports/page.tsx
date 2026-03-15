import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { ExportButton } from "@/components/dashboard/export-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Flame, Mail, CheckCircle } from "lucide-react";

export default function ExportsPage() {
  return (
    <div className="space-y-8">
      <DashboardHeader
        title="Export"
        description="Download your leads and outreach as CSV"
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
              Export all leads with enrichment data, scores, tech stack, and outreach.
            </p>
            <ExportButton />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Flame className="h-5 w-5 text-red-500" />
              Hot Leads (70+)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-zinc-400">
              Export only hot leads with a score of 70 or higher.
            </p>
            <ExportButton filters={{ min_score: "70", sort_by: "score", sort_order: "desc" }} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle className="h-5 w-5 text-emerald-500" />
              Enriched Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-zinc-400">
              Export only leads that have been successfully enriched.
            </p>
            <ExportButton filters={{ enrichment_status: "complete" }} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Mail className="h-5 w-5 text-blue-500" />
              Outreach Batch
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-zinc-400">
              Export outreach emails for pasting into your email tool.
            </p>
            <ExportButton
              filters={{ min_score: "40", sort_by: "score", sort_order: "desc" }}
              exportType="outreach"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
