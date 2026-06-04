"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ChevronDown, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LeadOption {
  id: string;
  business_name: string;
  website: string | null;
  city: string | null;
  state: string | null;
}

interface LeadPickerProps {
  value: string | null;
  onChange: (id: string | null, option: LeadOption | null) => void;
  placeholder?: string;
  className?: string;
}

export function LeadPicker({
  value,
  onChange,
  placeholder = "Attach to lead (optional)",
  className,
}: LeadPickerProps) {
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/leads/list?per_page=200");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.leads)) {
          setLeads(data.leads);
        }
      } catch {
        // Best-effort fetch — picker stays usable as empty list.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = useMemo(
    () => (value ? leads.find((l) => l.id === value) ?? null : null),
    [value, leads]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return leads.slice(0, 50);
    const q = query.toLowerCase();
    return leads
      .filter(
        (l) =>
          l.business_name.toLowerCase().includes(q) ||
          (l.website ?? "").toLowerCase().includes(q) ||
          (l.city ?? "").toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [leads, query]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-50 shadow-sm transition-colors hover:border-zinc-600"
      >
        <span className={selected ? "text-zinc-100" : "text-zinc-400"}>
          {selected ? selected.business_name : placeholder}
        </span>
        <div className="flex items-center gap-1.5">
          {selected && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null, null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null, null);
                }
              }}
              className="rounded p-0.5 text-zinc-500 hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        </div>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-xl">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-2.5 py-2">
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads..."
              className="h-7 border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {loading && (
              <p className="px-3 py-2 text-xs text-zinc-500">Loading leads...</p>
            )}
            {!loading && filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-500">No leads found</p>
            )}
            {!loading &&
              filtered.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => {
                    onChange(lead.id, lead);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800",
                    value === lead.id && "bg-zinc-800"
                  )}
                >
                  <div className="font-medium">{lead.business_name}</div>
                  <div className="text-xs text-zinc-500">
                    {[
                      lead.website?.replace(/^https?:\/\//, ""),
                      [lead.city, lead.state].filter(Boolean).join(", "),
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
