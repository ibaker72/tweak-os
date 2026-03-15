import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  className,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800 bg-zinc-900 p-6",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-400">{title}</p>
          <p className="mt-2 text-3xl font-bold text-zinc-50">{value}</p>
          {trend && (
            <p
              className={cn(
                "mt-1 text-xs",
                trend.positive ? "text-emerald-500" : "text-red-500"
              )}
            >
              {trend.value}
            </p>
          )}
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-3">
          <Icon className="h-5 w-5 text-emerald-500" />
        </div>
      </div>
    </div>
  );
}
