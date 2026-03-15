import { cn } from "@/lib/utils";

interface ScoreIndicatorProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

const sizeClasses: Record<"sm" | "md" | "lg", string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

function getScoreColors(score: number) {
  if (score >= 70) return "text-red-400 bg-red-500/10";
  if (score >= 40) return "text-orange-400 bg-orange-500/10";
  return "text-blue-400 bg-blue-500/10";
}

export function ScoreIndicator({ score, size = "md" }: ScoreIndicatorProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-bold",
        sizeClasses[size],
        getScoreColors(score)
      )}
    >
      {score}
    </span>
  );
}
