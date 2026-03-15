"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import type { Activity } from "./ActivityFeed";

interface Breadcrumb {
  label: string;
  href?: string;
}

interface ApiUsage {
  google_today: number;
  google_limit: number;
  openai_cost: number;
}

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  breadcrumbs?: Breadcrumb[];
  apiUsage?: ApiUsage;
  activities?: Activity[];
}

export function AppShell({
  children,
  title,
  breadcrumbs,
  apiUsage,
  activities = [],
}: AppShellProps) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950">
      <Sidebar
        apiUsage={
          apiUsage
            ? {
                google_today: apiUsage.google_today,
                google_limit: apiUsage.google_limit,
                openai_cost: apiUsage.openai_cost,
              }
            : undefined
        }
      />

      <Topbar
        title={title}
        breadcrumbs={breadcrumbs}
        onCommandPaletteOpen={() => setCommandPaletteOpen(true)}
        activities={activities}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />

      <main className="ml-64 pt-14">
        <div className="mx-auto max-w-7xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
