import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center sm:py-16">
      <Icon className="h-10 w-10 text-zinc-600" />
      <h3 className="mt-4 text-sm font-medium text-zinc-300">{title}</h3>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
      {action && (
        <div className="mt-6">
          {action.href ? (
            <Button
              asChild
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button
              onClick={action.onClick}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
