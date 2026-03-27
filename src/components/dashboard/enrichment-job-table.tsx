"use client";

import type { EnrichmentJob, ImportJob } from "@/lib/leads/types";
import { EnrichmentStatusBadge } from "./lead-status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export function EnrichmentJobTable({ jobs }: { jobs: EnrichmentJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
        <p className="text-sm text-zinc-400">No enrichment jobs yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/80">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Job ID
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Lead ID
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Error
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {jobs.map((job) => (
            <tr key={job.id} className="bg-zinc-950">
              <td className="px-4 py-3 text-sm font-mono text-zinc-400">
                {job.id.slice(0, 8)}
              </td>
              <td className="px-4 py-3 text-sm font-mono text-zinc-400">
                {job.lead_id.slice(0, 8)}
              </td>
              <td className="px-4 py-3 text-center">
                <EnrichmentStatusBadge status={job.status as "pending" | "crawling" | "complete" | "failed"} />
              </td>
              <td className="px-4 py-3 text-sm text-red-400">
                {job.error_message || "—"}
              </td>
              <td className="px-4 py-3 text-sm text-zinc-500">
                {formatDate(job.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportJobTable({ jobs }: { jobs: ImportJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
        <p className="text-sm text-zinc-400">No import jobs yet</p>
      </div>
    );
  }

  const statusVariant = (s: string) => {
    switch (s) {
      case "completed":
        return "success" as const;
      case "failed":
        return "destructive" as const;
      case "processing":
        return "warning" as const;
      default:
        return "outline" as const;
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/80">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Filename
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
              Status
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
              Total
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
              Imported
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
              Failed
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {jobs.map((job) => (
            <tr key={job.id} className="bg-zinc-950">
              <td className="px-4 py-3 text-sm text-zinc-300">
                {job.filename}
              </td>
              <td className="px-4 py-3 text-center">
                <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
              </td>
              <td className="px-4 py-3 text-center text-sm text-zinc-400">
                {job.total_rows}
              </td>
              <td className="px-4 py-3 text-center text-sm text-lime-400">
                {job.imported_rows}
              </td>
              <td className="px-4 py-3 text-center text-sm text-red-400">
                {job.failed_rows}
              </td>
              <td className="px-4 py-3 text-sm text-zinc-500">
                {formatDate(job.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
