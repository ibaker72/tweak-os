import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";

/**
 * Every /admin page is admin-only.
 *
 * The layout gate is defence in depth, not the boundary: the API routes each
 * call requireAdmin() themselves, and RLS is what actually stops an agent
 * reading another agent's money. This just means an agent who guesses the URL
 * gets a redirect rather than an empty page full of failed requests.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/my/queue");

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
        {[
          { href: "/admin/commissions", label: "Commissions" },
          { href: "/admin/revenue", label: "Revenue" },
          { href: "/admin/team", label: "Team" },
          { href: "/admin/attribution", label: "Attribution" },
        ].map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
