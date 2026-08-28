import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/auth/guard";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Only used to decide whether the admin nav group is rendered. Access is
  // enforced by the /admin layout, by requireAdmin() in each route, and by RLS
  // — this just avoids showing an agent links that would bounce them.
  const guard = await requireUser();
  const isAdmin = guard.ok && guard.agent.role === "admin";

  return <AppShell isAdmin={isAdmin}>{children}</AppShell>;
}
