"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  GitBranch,
  TrendingUp,
  Wallet,
  Users,
  Compass,
  Upload,
  FileText,
  Settings,
  X,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/Logo";
import { InstallAppButton } from "./InstallAppButton";
import { SmartListsSidebar } from "./SmartListsSidebar";

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
    label: "MY WORK",
    items: [
      { label: "My Queue", href: "/my/queue", icon: ClipboardList },
      { label: "My Pipeline", href: "/my/pipeline", icon: TrendingUp },
      { label: "My Commissions", href: "/my/commissions", icon: Wallet },
      { label: "Import My Leads", href: "/my/import", icon: Upload },
    ],
  },
  {
    label: "OUTBOUND",
    items: [
      { label: "Leads", href: "/leads", icon: Users },
      { label: "Proposals", href: "/proposals", icon: FileText },
      { label: "Discover", href: "/leads/discover", icon: Compass },
      { label: "Import", href: "/leads/import", icon: Upload },
    ],
  },
];

interface ApiUsageProps {
  google_today?: number;
  google_limit?: number;
  openai_cost?: number;
}

/**
 * Admin-only navigation. Hidden from agents rather than shown and then
 * redirected — a nav item that always bounces you is worse than no nav item.
 * This is presentation only: the layout, the routes and RLS are what actually
 * enforce it.
 */
const adminGroup: NavGroup = {
  label: "ADMIN",
  items: [
    { label: "Commissions", href: "/admin/commissions", icon: Wallet },
    { label: "Revenue", href: "/admin/revenue", icon: BarChart3 },
    { label: "Team", href: "/admin/team", icon: Users },
    { label: "Attribution", href: "/admin/attribution", icon: GitBranch },
  ],
};

interface SidebarProps {
  apiUsage?: ApiUsageProps;
  isAdmin?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({
  apiUsage,
  isAdmin = false,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const groups = isAdmin ? [...navGroups, adminGroup] : navGroups;

  const googleToday = apiUsage?.google_today ?? 847;
  const googleLimit = apiUsage?.google_limit ?? 10_000;
  const openaiCost = apiUsage?.openai_cost ?? 2.14;
  const googlePercent = Math.min((googleToday / googleLimit) * 100, 100);

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  function isActive(href: string): boolean {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(href + "/");
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b border-zinc-800 px-5">
        <Link href="/dashboard" onClick={onMobileClose}>
          <Logo size={32} />
        </Link>
        {/* Close button: visible only on mobile */}
        <button
          onClick={onMobileClose}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {/* Dashboard */}
        <NavLink
          href="/dashboard"
          icon={LayoutDashboard}
          label="Dashboard"
          active={isActive("/dashboard")}
          onClick={onMobileClose}
        />

        {/* Groups */}
        {groups.map((group) => (
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
                onClick={onMobileClose}
              />
            ))}
          </div>
        ))}

        {/* Smart Lists */}
        <SmartListsSidebar onMobileClose={onMobileClose} />

        {/* Separator */}
        <div className="my-4 border-t border-zinc-800" />

        {/* Settings */}
        <NavLink
          href="/settings"
          icon={Settings}
          label="Settings"
          active={isActive("/settings")}
          onClick={onMobileClose}
        />
      </nav>

      {/* Install App */}
      <div className="border-t border-zinc-800 px-4 py-3">
        <InstallAppButton />
      </div>

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
                className="h-full rounded-full bg-lime-400 transition-all"
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
    </>
  );

  return (
    <>
      {/* Desktop sidebar: persistent, always visible at lg+ */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col bg-zinc-950 border-r border-zinc-800 lg:flex">
        {sidebarContent}
      </aside>

      {/* Mobile sidebar: overlay drawer */}
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onMobileClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-screen w-72 flex-col bg-zinc-950 border-r border-zinc-800 shadow-2xl transition-transform duration-300 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-l-2 border-lime-400 bg-lime-400/10 text-lime-400"
          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-50"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  );
}
