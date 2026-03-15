"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Zap,
  LayoutDashboard,
  Users,
  Compass,
  Upload,
  TrendingUp,
  Search,
  LayoutList,
  Calendar,
  FileText,
  BarChart3,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "OUTBOUND",
    items: [
      { label: "Leads", href: "/leads", icon: Users },
      { label: "Discover", href: "/leads/discover", icon: Compass },
      { label: "Import", href: "/leads/import", icon: Upload },
    ],
  },
  {
    label: "INBOUND",
    items: [
      { label: "Growth", href: "/growth", icon: TrendingUp },
      { label: "Opportunities", href: "/growth/opportunities", icon: Search },
      { label: "Pipeline", href: "/growth/pipeline", icon: LayoutList },
      { label: "Calendar", href: "/growth/calendar", icon: Calendar },
      { label: "Drafts", href: "/growth/drafts", icon: FileText },
      { label: "Analytics", href: "/growth/analytics", icon: BarChart3 },
    ],
  },
];

interface ApiUsageProps {
  google_today?: number;
  google_limit?: number;
  openai_cost?: number;
}

interface SidebarProps {
  collapsed?: boolean;
  apiUsage?: ApiUsageProps;
}

export function Sidebar({ collapsed = false, apiUsage }: SidebarProps) {
  const pathname = usePathname();

  const googleToday = apiUsage?.google_today ?? 847;
  const googleLimit = apiUsage?.google_limit ?? 10_000;
  const openaiCost = apiUsage?.openai_cost ?? 2.14;
  const googlePercent = Math.min((googleToday / googleLimit) * 100, 100);

  function isActive(href: string): boolean {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-zinc-950 transition-transform duration-200",
        collapsed && "-translate-x-full"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-zinc-800 px-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-semibold text-zinc-100">
            Tweak OS
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {/* Dashboard */}
        <NavLink
          href="/dashboard"
          icon={LayoutDashboard}
          label="Dashboard"
          active={isActive("/dashboard")}
        />

        {/* Groups */}
        {navGroups.map((group) => (
          <div key={group.label} className="mt-6">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                active={isActive(item.href)}
              />
            ))}
          </div>
        ))}

        {/* Separator */}
        <div className="my-4 border-t border-zinc-800" />

        {/* Settings */}
        <NavLink
          href="/settings"
          icon={Settings}
          label="Settings"
          active={isActive("/settings")}
        />
      </nav>

      {/* API Usage */}
      <div className="border-t border-zinc-800 px-4 py-4">
        <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          API Usage
        </div>

        <div className="space-y-3">
          {/* Google */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-400">
              <span>Google</span>
              <span>
                {googleToday.toLocaleString()} / {googleLimit.toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${googlePercent}%` }}
              />
            </div>
          </div>

          {/* OpenAI */}
          <div>
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>OpenAI</span>
              <span>${openaiCost.toFixed(2)} this month</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-l-2 border-emerald-500 bg-emerald-500/10 text-emerald-400"
          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-50"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}
