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
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center sm:p-12">
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="break-all text-sm font-medium text-zinc-100">
              {job.filename}
            </p>
            <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="Total" value={job.total_rows} tone="muted" />
            <Stat label="Imported" value={job.imported_rows} tone="success" />
            <Stat label="Skipped" value={job.skipped_rows ?? 0} tone="warn" />
            <Stat label="Failed" value={job.failed_rows} tone="danger" />
          </dl>
          <p className="mt-3 text-xs text-zinc-500">{formatDate(job.created_at)}</p>
        </div>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "success" | "warn" | "danger";
}) {
  const color =
    tone === "success"
      ? "text-lime-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "danger"
          ? "text-red-400"
          : "text-zinc-300";
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className={`text-base font-semibold ${color}`}>{value}</dd>
    </div>
  );
}
