"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X, SlidersHorizontal } from "lucide-react";

interface LeadsFiltersProps {
  currentFilters: Record<string, string>;
}

export function LeadsFilters({ currentFilters }: LeadsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(currentFilters.search ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);

  function applyFilter(key: string, value: string) {
    const params = new URLSearchParams(currentFilters);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    applyFilter("search", search);
  }

  function clearFilters() {
    setSearch("");
    router.push(pathname);
  }

  const hasFilters = Object.keys(currentFilters).length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <form onSubmit={handleSearchSubmit} className="w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 sm:w-64"
            />
          </div>
        </form>

        <Select
          value={currentFilters.lifecycle_status ?? ""}
          onChange={(e) => applyFilter("lifecycle_status", e.target.value)}
          className="flex-1 sm:flex-none sm:w-40"
        >
          <option value="">All Statuses</option>
          <option value="new">New</option>
          <option value="enriched">Enriched</option>
          <option value="contacted">Contacted</option>
          <option value="replied">Replied</option>
          <option value="meeting_booked">Meeting Booked</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="not_a_fit">Not a Fit</option>
        </Select>

        <Select
          value={currentFilters.min_score ?? ""}
          onChange={(e) => applyFilter("min_score", e.target.value)}
          className="flex-1 sm:flex-none sm:w-36"
        >
          <option value="">All Scores</option>
          <option value="70">Hot (70+)</option>
          <option value="40">Warm (40+)</option>
          <option value="1">Has Score</option>
        </Select>

        <Select
          value={currentFilters.sort_by ?? "created_at"}
          onChange={(e) => applyFilter("sort_by", e.target.value)}
          className="hidden sm:block sm:w-36"
        >
          <option value="created_at">Newest</option>
          <option value="score">Score</option>
          <option value="business_name">Name</option>
          <option value="updated_at">Updated</option>
        </Select>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
        </Button>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        )}
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 sm:gap-3">
          <Select
            value={currentFilters.enrichment_status ?? ""}
            onChange={(e) => applyFilter("enrichment_status", e.target.value)}
            className="flex-1 sm:flex-none sm:w-36"
          >
            <option value="">All Enrichment</option>
            <option value="pending">Pending</option>
            <option value="crawling">Crawling</option>
            <option value="complete">Complete</option>
            <option value="failed">Failed</option>
          </Select>

          <Input
            placeholder="Industry..."
            value={currentFilters.industry ?? ""}
            onChange={(e) => applyFilter("industry", e.target.value)}
            className="flex-1 sm:flex-none sm:w-40"
          />

          <Input
            placeholder="City..."
            value={currentFilters.city ?? ""}
            onChange={(e) => applyFilter("city", e.target.value)}
            className="flex-1 sm:flex-none sm:w-36"
          />

          <Input
            placeholder="State"
            value={currentFilters.state ?? ""}
            onChange={(e) => applyFilter("state", e.target.value)}
            className="w-20 sm:w-28"
          />

          <Input
            placeholder="Tech stack..."
            value={currentFilters.tech_stack ?? ""}
            onChange={(e) => applyFilter("tech_stack", e.target.value)}
            className="flex-1 sm:flex-none sm:w-36"
          />
        </div>
      )}
    </div>
  );
}
