import { cn } from "@/lib/utils";
import type { OpportunityGrade } from "@/lib/audits/types";

interface OpportunityGradeBadgeProps {
  grade: OpportunityGrade | null | undefined;
  estimatedLeadsLost?: number | null;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

const GRADE_STYLES: Record<OpportunityGrade, string> = {
  "A+": "bg-lime-400 text-zinc-950",
  A: "bg-green-500 text-zinc-50",
  B: "bg-amber-500 text-zinc-950",
  C: "bg-red-500 text-zinc-50",
};

const SIZE_STYLES = {
  sm: "h-7 w-10 text-xs",
  md: "h-12 w-16 text-2xl",
  lg: "h-24 w-32 text-5xl",
};

export function OpportunityGradeBadge({
  grade,
  estimatedLeadsLost,
  size = "md",
  showLabel = false,
  className,
}: OpportunityGradeBadgeProps) {
  if (!grade) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-lg bg-zinc-800 font-bold text-zinc-500",
          SIZE_STYLES[size],
          className
        )}
      >
        —
      </span>
    );
  }

  if (showLabel) {
    return (
      <div className={cn("flex flex-col items-center gap-1.5", className)}>
        <p className="text-[11px] font-medium uppercase tracking-widest text-zinc-500">
          Opportunity Grade
        </p>
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-xl font-extrabold shadow-lg",
            GRADE_STYLES[grade],
            SIZE_STYLES[size]
          )}
        >
          {grade}
        </span>
        {typeof estimatedLeadsLost === "number" && estimatedLeadsLost > 0 && (
          <p className="text-xs text-zinc-500">
            Estimated {estimatedLeadsLost} leads lost/month
          </p>
        )}
      </div>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-bold",
        GRADE_STYLES[grade],
        SIZE_STYLES[size],
        className
      )}
    >
      {grade}
    </span>
  );
}
