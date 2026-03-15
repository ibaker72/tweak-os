"use client";

import * as Popover from "@radix-ui/react-popover";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Activity {
  id: string;
  module: "leads" | "growth" | string;
  action: string;
  entity_type: string;
  created_at: string;
}

interface ActivityFeedProps {
  activities?: Activity[];
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function moduleColor(module: string): string {
  switch (module) {
    case "leads":
      return "bg-emerald-500";
    case "growth":
      return "bg-blue-500";
    default:
      return "bg-zinc-500";
  }
}

export function ActivityFeed({ activities = [] }: ActivityFeedProps) {
  const recent = activities.slice(0, 10);
  const hasActivity = recent.length > 0;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="relative rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300">
          <Bell className="h-4 w-4" />
          {hasActivity && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-emerald-500" />
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl"
        >
          <div className="border-b border-zinc-800 px-4 py-3">
            <h3 className="text-sm font-medium text-zinc-200">
              Recent Activity
            </h3>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">
                No recent activity
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {recent.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 px-4 py-3"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        moduleColor(activity.module)
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-300">
                        {activity.action}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {activity.entity_type} &middot;{" "}
                        {relativeTime(activity.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
