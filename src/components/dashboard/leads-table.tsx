"use client";

import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/leads/types";
import {
  LifecycleStatusBadge,
  EnrichmentStatusBadge,
} from "./lead-status-badge";
import { truncate } from "@/lib/utils";

interface LeadsTableProps {
  leads: Lead[];
}

export function LeadsTable({ leads }: LeadsTableProps) {
  const router = useRouter();

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
        <p className="text-sm text-zinc-400">No leads found</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800">
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/80">
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Business
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Location
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Niche
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
              Score
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
              Status
            </th>
            <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
              Enrichment
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
              Contact
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {leads.map((lead) => (
            <tr
              key={lead.id}
              onClick={() => router.push(`/dashboard/leads/${lead.id}`)}
              className="cursor-pointer bg-zinc-950 transition-colors hover:bg-zinc-900/50"
            >
              <td className="px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-zinc-50">
                    {truncate(lead.business_name, 30)}
                  </p>
                  {lead.website && (
                    <p className="text-xs text-zinc-500">
                      {truncate(lead.website.replace(/https?:\/\//, ""), 25)}
                    </p>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-zinc-400">
                {[lead.city, lead.state].filter(Boolean).join(", ") || "—"}
              </td>
              <td className="px-4 py-3 text-sm text-zinc-400">
                {lead.niche || "—"}
              </td>
              <td className="px-4 py-3 text-center">
                <ScoreIndicator score={lead.score} />
              </td>
              <td className="px-4 py-3 text-center">
                <LifecycleStatusBadge status={lead.lifecycle_status} />
              </td>
              <td className="px-4 py-3 text-center">
                <EnrichmentStatusBadge status={lead.enrichment_status} />
              </td>
              <td className="px-4 py-3 text-sm text-zinc-400">
                {lead.email_1 || lead.phone_1 || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreIndicator({ score }: { score: number }) {
  let color = "text-zinc-500";
  if (score >= 70) color = "text-emerald-400";
  else if (score >= 40) color = "text-amber-400";
  else if (score > 0) color = "text-red-400";

  return (
    <span className={`text-sm font-bold ${color}`}>
      {score}
    </span>
  );
}
