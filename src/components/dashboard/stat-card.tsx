import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  className?: string;
}

export function StatCard({ title, value, icon: Icon, trend, className }: StatCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-400">{title}</p>
            <p className="mt-2 text-3xl font-bold text-zinc-50">{value}</p>
            {trend && (
              <p className="mt-1 text-xs text-zinc-500">{trend}</p>
            )}
          </div>
          <div className="rounded-lg bg-lime-400/10 p-3">
            <Icon className="h-5 w-5 text-lime-400" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
