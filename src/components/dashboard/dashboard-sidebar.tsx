"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Upload,
  Download,
  Search,
  Compass,
  BookmarkCheck,
  Zap,
} from "lucide-react";

const navItems = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Discover", href: "/dashboard/discover", icon: Compass },
  { label: "Leads", href: "/dashboard/leads", icon: Users },
  { label: "Import", href: "/dashboard/imports", icon: Upload },
  { label: "Export", href: "/dashboard/exports", icon: Download },
  { label: "Saved Searches", href: "/dashboard/saved-searches", icon: BookmarkCheck },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-30 flex h-screen w-64 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-zinc-800 px-6">
        <a
          href="https://tweakandbuild.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lime-400/10">
            <Zap className="h-4 w-4 text-lime-400" />
          </div>
          <div>
            <span className="text-sm font-bold text-zinc-50">
              Tweak & Build
            </span>
            <p className="text-[10px] text-zinc-500">Lead Finder</p>
          </div>
        </a>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-lime-400/10 text-lime-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-50"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-800 p-4">
        <p className="text-[10px] text-zinc-600">
          Internal Tool — Tweak & Build Studio {new Date().getFullYear()}
        </p>
      </div>
    </aside>
  );
}
