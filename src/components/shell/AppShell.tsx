"use client";

import { useState, useCallback, useEffect } from "react";
import { usePathname } from "next/navigation";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
  }, []);

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
        mobileOpen={sidebarOpen}
        onMobileClose={handleSidebarClose}
      />

      <Topbar
        title={title}
        breadcrumbs={breadcrumbs}
        onCommandPaletteOpen={() => setCommandPaletteOpen(true)}
        onMenuToggle={handleSidebarToggle}
        activities={activities}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      />

      {/* Main content: offset by sidebar on lg+, full width below */}
      <main className="pt-14 lg:ml-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
