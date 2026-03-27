"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Flame,
  Phone,
  Clock,
  Sparkles,
  Target,
  ChevronDown,
  ChevronRight,
  List,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SmartList {
  id: string;
  name: string;
  icon: string;
  filters: Record<string, unknown>;
  is_pinned: boolean;
}

const defaultIcons: Record<string, typeof List> = {
  flame: Flame,
  phone: Phone,
  clock: Clock,
  sparkles: Sparkles,
  target: Target,
  list: List,
};

const defaultSmartLists = [
  { name: "Hot Leads", icon: "flame" },
  { name: "Follow Up Today", icon: "phone" },
  { name: "Overdue Follow-ups", icon: "clock" },
  { name: "Fresh Imports", icon: "sparkles" },
  { name: "Ready to Close", icon: "target" },
];

export function SmartListsSidebar({
  onMobileClose,
}: {
  onMobileClose?: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [smartLists, setSmartLists] = useState<SmartList[]>([]);

  useEffect(() => {
    fetch("/api/smart-lists")
      .then((r) => r.json())
      .then((data) => setSmartLists(data.smart_lists ?? []))
      .catch(() => {});
  }, []);

  const displayLists =
    smartLists.length > 0
      ? smartLists
      : defaultSmartLists.map((d, i) => ({
          id: `default-${i}`,
          name: d.name,
          icon: d.icon,
          filters: {},
          is_pinned: true,
        }));

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 hover:text-zinc-400"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Smart Lists
      </button>

      {expanded && (
        <div className="space-y-0.5">
          {displayLists.map((list) => {
            const Icon = defaultIcons[list.icon] ?? List;
            return (
              <Link
                key={list.id}
                href={`/leads?smart_list=${list.id}`}
                onClick={onMobileClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-200"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-xs">{list.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
