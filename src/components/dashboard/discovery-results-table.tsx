"use client";

import { useState } from "react";
import type { DiscoveryResult } from "@/lib/leads/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { truncate } from "@/lib/utils";
import { CheckCircle, Download, Loader2, Filter } from "lucide-react";

interface DiscoveryResultsTableProps {
  results: DiscoveryResult[];
  onImport: (ids: string[]) => Promise<void>;
}

export function DiscoveryResultsTable({
  results,
  onImport,
}: DiscoveryResultsTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importedIds, setImportedIds] = useState<Set<string>>(
    new Set(results.filter((r) => r.imported).map((r) => r.id))
  );
  const [showPromisingOnly, setShowPromisingOnly] = useState(false);

  const importableResults = results.filter((r) => !r.imported && !importedIds.has(r.id));
  const allSelected =
    importableResults.length > 0 &&
    importableResults.every((r) => selected.has(r.id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importableResults.map((r) => r.id)));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setImporting(true);
    try {
      await onImport(Array.from(selected));
      setImportedIds((prev) => new Set([...prev, ...selected]));
      setSelected(new Set());
    } finally {
      setImporting(false);
    }
  }

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
        <p className="text-sm text-zinc-400">No results yet. Run a discovery to find leads.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <p className="text-sm text-zinc-400">
            {results.length} found &middot;{" "}
            {selected.size} selected &middot;{" "}
            {importedIds.size} imported
          </p>
          <button
            onClick={() => setShowPromisingOnly(!showPromisingOnly)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
              showPromisingOnly
                ? "border-lime-400/30 bg-lime-400/10 text-lime-400"
                : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Filter className="h-3 w-3" />
            Promising only (40+)
          </button>
        </div>
        <Button
          onClick={handleImport}
          disabled={selected.size === 0 || importing}
          size="sm"
        >
          {importing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {importing
            ? "Importing..."
            : `Import ${selected.size} Selected`}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80">
              <th className="w-10 px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-lime-400"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Business
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Location
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Website
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
                Est. Score
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
                Platform
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
                Rating
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-400">
                Source
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-zinc-400">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {results
              .filter((r) => !showPromisingOnly || ((r as unknown as Record<string, unknown>).estimated_score as number ?? 0) > 40)
              .sort((a, b) => ((b as unknown as Record<string, unknown>).estimated_score as number ?? 0) - ((a as unknown as Record<string, unknown>).estimated_score as number ?? 0))
              .map((result) => {
              const isImported = result.imported || importedIds.has(result.id);
              const estScore = (result as unknown as Record<string, unknown>).estimated_score as number | null;
              const platform = (result as unknown as Record<string, unknown>).detected_platform as string | null;
              const isDuplicate = (result as unknown as Record<string, unknown>).is_duplicate as boolean;
              return (
                <tr
                  key={result.id}
                  className={`bg-zinc-950 transition-colors ${
                    isImported
                      ? "opacity-60"
                      : selected.has(result.id)
                        ? "bg-zinc-900"
                        : "hover:bg-zinc-900/50"
                  }`}
                >
                  <td className="px-4 py-3 text-center">
                    {isImported ? (
                      <CheckCircle className="mx-auto h-4 w-4 text-lime-400" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={selected.has(result.id)}
                        onChange={() => toggleOne(result.id)}
                        className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-lime-400"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-zinc-50">
                    {truncate(result.business_name, 35)}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {[result.city, result.state].filter(Boolean).join(", ") ||
                      "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {result.website ? (
                      <a
                        href={result.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {truncate(
                          result.website.replace(/https?:\/\//, ""),
                          30
                        )}
                      </a>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {estScore != null ? (
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${
                        estScore >= 70 ? "bg-red-500/10 text-red-400" :
                        estScore >= 40 ? "bg-orange-500/10 text-orange-400" :
                        "bg-blue-500/10 text-blue-400"
                      }`}>
                        {estScore}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {platform ? (
                      <Badge variant="secondary" className="text-[10px]">{platform}</Badge>
                    ) : isDuplicate ? (
                      <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">Duplicate</Badge>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-zinc-400">
                    {result.google_rating ? (
                      <span>
                        <span className="text-yellow-500">{result.google_rating}</span>
                        {result.google_review_count ? (
                          <span className="text-zinc-500 text-xs"> ({result.google_review_count})</span>
                        ) : null}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {result.source || "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {isImported ? (
                      <Badge variant="success">Imported</Badge>
                    ) : (
                      <Badge variant="outline">Ready</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
