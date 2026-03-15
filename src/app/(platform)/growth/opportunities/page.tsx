"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Search,
  ArrowUpDown,
  Loader2,
  ChevronUp,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OPPORTUNITY_STATUSES, SEARCH_INTENTS } from "@/lib/shared/constants";
import type { GrowthOpportunity, OpportunityStatus } from "@/types/growth";

type SortField =
  | "keyword"
  | "search_volume"
  | "relevance_score"
  | "opportunity_score"
  | "intent"
  | "cluster"
  | "status";
type SortDir = "asc" | "desc";

const intentBadgeVariant: Record<string, "info" | "warning" | "success" | "secondary"> = {
  informational: "info",
  commercial: "warning",
  transactional: "success",
  navigational: "secondary",
};

const statusBadgeVariant: Record<string, "secondary" | "info" | "warning" | "success" | "destructive"> = {
  discovered: "secondary",
  planned: "info",
  in_progress: "warning",
  published: "success",
  declined: "destructive",
};

export default function OpportunitiesPage() {
  const [opportunities, setOpportunities] = useState<GrowthOpportunity[]>([]);
  const [seedKeyword, setSeedKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("opportunity_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  async function fetchOpportunities() {
    try {
      setLoading(true);
      const res = await fetch("/api/growth/opportunities");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setOpportunities(Array.isArray(data) ? data : data.opportunities ?? []);
    } catch (err) {
      setError("Failed to load opportunities");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOpportunities();
  }, []);

  async function handleDiscover() {
    if (!seedKeyword.trim()) return;
    try {
      setDiscovering(true);
      setError(null);
      const res = await fetch("/api/growth/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seed: seedKeyword.trim() }),
      });
      if (!res.ok) throw new Error("Discovery failed");
      await fetchOpportunities();
      setSeedKeyword("");
    } catch (err) {
      setError("Failed to discover opportunities");
      console.error(err);
    } finally {
      setDiscovering(false);
    }
  }

  async function updateStatus(id: string, status: OpportunityStatus) {
    try {
      const res = await fetch(`/api/growth/opportunities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error("Update failed");
      setOpportunities((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status } : o))
      );
    } catch (err) {
      console.error(err);
    }
  }

  async function handleBulkPlanned() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch("/api/growth/opportunities", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, status: "planned" }),
          })
        )
      );
      setOpportunities((prev) =>
        prev.map((o) =>
          selected.has(o.id) ? { ...o, status: "planned" as const } : o
        )
      );
      setSelected(new Set());
    } catch (err) {
      console.error(err);
    } finally {
      setBulkLoading(false);
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((o) => o.id)));
    }
  }

  const sorted = useMemo(() => {
    const copy = [...opportunities];
    copy.sort((a, b) => {
      let aVal: string | number | null = a[sortField] as string | number | null;
      let bVal: string | number | null = b[sortField] as string | number | null;
      if (aVal == null) aVal = sortDir === "asc" ? Infinity : -Infinity;
      if (bVal == null) bVal = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    return copy;
  }, [opportunities, sortField, sortDir]);

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field)
      return <ArrowUpDown className="h-3 w-3 text-zinc-600" />;
    return sortDir === "asc" ? (
      <ChevronUp className="h-3 w-3 text-emerald-500" />
    ) : (
      <ChevronDown className="h-3 w-3 text-emerald-500" />
    );
  }

  const columns: { field: SortField; label: string }[] = [
    { field: "keyword", label: "Keyword" },
    { field: "search_volume", label: "Est. Demand" },
    { field: "relevance_score", label: "Relevance" },
    { field: "opportunity_score", label: "Opp. Score" },
    { field: "intent", label: "Intent" },
    { field: "cluster", label: "Cluster" },
    { field: "status", label: "Status" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Opportunities</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Discover keywords and topics your potential clients are searching for
        </p>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Enter a seed keyword..."
            value={seedKeyword}
            onChange={(e) => setSeedKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
            className="pl-9"
          />
        </div>
        <Button onClick={handleDiscover} disabled={discovering || !seedKeyword.trim()}>
          {discovering ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Discover
        </Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2">
          <span className="text-sm text-zinc-400">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleBulkPlanned}
            disabled={bulkLoading}
          >
            {bulkLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            Mark as Planned
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {/* Discovering skeleton */}
      {discovering && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            <p className="text-sm text-zinc-400">
              Discovering opportunities for &ldquo;{seedKeyword}&rdquo;...
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results table */}
      {!loading && !discovering && opportunities.length > 0 && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-900/80 border-b border-zinc-800">
                  <th className="p-3 text-left">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === sorted.length && sorted.length > 0
                      }
                      onChange={toggleSelectAll}
                      className="rounded border-zinc-600"
                    />
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.field}
                      className="p-3 text-left text-xs font-medium text-zinc-400 cursor-pointer hover:text-zinc-200 transition-colors"
                      onClick={() => handleSort(col.field)}
                    >
                      <span className="flex items-center gap-1">
                        {col.label}
                        <SortIcon field={col.field} />
                      </span>
                    </th>
                  ))}
                  <th className="p-3 text-left text-xs font-medium text-zinc-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((opp) => (
                  <tr
                    key={opp.id}
                    className={cn(
                      "border-b border-zinc-800/50 hover:bg-zinc-800/50 transition-colors",
                      selected.has(opp.id) && "bg-zinc-800/30"
                    )}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selected.has(opp.id)}
                        onChange={() => toggleSelect(opp.id)}
                        className="rounded border-zinc-600"
                      />
                    </td>
                    <td className="p-3 text-zinc-200 font-medium">
                      {opp.keyword}
                    </td>
                    <td className="p-3 text-zinc-300">
                      {opp.search_volume != null
                        ? opp.search_volume.toLocaleString()
                        : "--"}
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "font-medium",
                          opp.relevance_score >= 0.7
                            ? "text-emerald-400"
                            : opp.relevance_score >= 0.4
                            ? "text-amber-400"
                            : "text-zinc-400"
                        )}
                      >
                        {(opp.relevance_score * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={cn(
                          "font-bold",
                          opp.opportunity_score >= 70
                            ? "text-emerald-400"
                            : opp.opportunity_score >= 40
                            ? "text-amber-400"
                            : "text-zinc-400"
                        )}
                      >
                        {opp.opportunity_score}
                      </span>
                    </td>
                    <td className="p-3">
                      {opp.intent && (
                        <Badge variant={intentBadgeVariant[opp.intent] ?? "secondary"}>
                          {opp.intent}
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 text-zinc-400">{opp.cluster ?? "--"}</td>
                    <td className="p-3">
                      <Select
                        value={opp.status}
                        onChange={(e) =>
                          updateStatus(
                            opp.id,
                            e.target.value as OpportunityStatus
                          )
                        }
                        className="h-7 text-xs w-32"
                      >
                        {OPPORTUNITY_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant={statusBadgeVariant[opp.status] ?? "secondary"}
                        className="text-[10px]"
                      >
                        {opp.status.replace("_", " ")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !discovering && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !discovering && opportunities.length === 0 && !error && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-16 text-center">
          <Search className="h-12 w-12 text-zinc-700 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-zinc-300 mb-1">
            Enter a seed keyword to discover opportunities
          </h3>
          <p className="text-sm text-zinc-500">
            Find topics your potential clients are searching for.
          </p>
        </div>
      )}
    </div>
  );
}
