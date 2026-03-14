"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";

interface LeadsFiltersProps {
  currentFilters: Record<string, string>;
}

export function LeadsFilters({ currentFilters }: LeadsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(currentFilters.search ?? "");

  function applyFilter(key: string, value: string) {
    const params = new URLSearchParams(currentFilters);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page"); // Reset to page 1
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
    <div className="flex flex-wrap items-center gap-3">
      <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 pl-9"
          />
        </div>
      </form>

      <Select
        value={currentFilters.lifecycle_status ?? ""}
        onChange={(e) => applyFilter("lifecycle_status", e.target.value)}
        className="w-40"
      >
        <option value="">All Statuses</option>
        <option value="new">New</option>
        <option value="contacted">Contacted</option>
        <option value="qualified">Qualified</option>
        <option value="proposal">Proposal</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
        <option value="archived">Archived</option>
      </Select>

      <Select
        value={currentFilters.enrichment_status ?? ""}
        onChange={(e) => applyFilter("enrichment_status", e.target.value)}
        className="w-40"
      >
        <option value="">All Enrichment</option>
        <option value="pending">Pending</option>
        <option value="in_progress">In Progress</option>
        <option value="completed">Completed</option>
        <option value="failed">Failed</option>
      </Select>

      <Select
        value={currentFilters.sort_by ?? "created_at"}
        onChange={(e) => applyFilter("sort_by", e.target.value)}
        className="w-40"
      >
        <option value="created_at">Newest</option>
        <option value="score">Score</option>
        <option value="business_name">Name</option>
        <option value="updated_at">Updated</option>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="h-4 w-4" />
          Clear
        </Button>
      )}
    </div>
  );
}
