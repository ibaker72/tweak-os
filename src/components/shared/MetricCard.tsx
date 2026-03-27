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
        "rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5 lg:p-6",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-zinc-400 sm:text-sm">{title}</p>
          <p className="mt-1.5 text-2xl font-bold text-zinc-50 sm:mt-2 sm:text-3xl">{value}</p>
          {trend && (
            <p
              className={cn(
                "mt-1 text-xs",
                trend.positive ? "text-lime-400" : "text-red-500"
              )}
            >
              {trend.value}
            </p>
          )}
        </div>
        <div className="shrink-0 rounded-lg bg-lime-400/10 p-2.5 sm:p-3">
          <Icon className="h-4 w-4 text-lime-400 sm:h-5 sm:w-5" />
        </div>
      </div>
    </div>
  );
}
