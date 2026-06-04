import { cn } from "@/lib/utils";

interface AuditScoreCardProps {
  label: string;
  score: number | null | undefined;
  className?: string;
}

function scoreColor(score: number): {
  text: string;
  ring: string;
  bg: string;
} {
  if (score >= 80) {
    return {
      text: "text-lime-400",
      ring: "stroke-lime-400",
      bg: "bg-lime-400/10",
    };
  }
  if (score >= 60) {
    return {
      text: "text-amber-400",
      ring: "stroke-amber-400",
      bg: "bg-amber-400/10",
    };
  }
  return {
    text: "text-red-400",
    ring: "stroke-red-400",
    bg: "bg-red-400/10",
  };
}

export function AuditScoreCard({ label, score, className }: AuditScoreCardProps) {
  const hasScore = typeof score === "number" && Number.isFinite(score);
  const value = hasScore ? Math.max(0, Math.min(100, Math.round(score as number))) : 0;
  const colors = hasScore ? scoreColor(value) : null;

  // SVG ring math (r=24, circumference ~150.8)
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-center",
        className
      )}
    >
      <div className="relative h-16 w-16">
        <svg className="h-16 w-16 -rotate-90" viewBox="0 0 60 60">
          <circle
            cx="30"
            cy="30"
            r={radius}
            strokeWidth="4"
            fill="transparent"
            className="stroke-zinc-800"
          />
          {hasScore && colors && (
            <circle
              cx="30"
              cy="30"
              r={radius}
              strokeWidth="4"
              fill="transparent"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className={colors.ring}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "text-lg font-bold",
              hasScore && colors ? colors.text : "text-zinc-600"
            )}
          >
            {hasScore ? value : "—"}
          </span>
        </div>
      </div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
    </div>
  );
}
