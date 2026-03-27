import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "warning" | "danger" | "info";

interface StatusBadgeProps {
  status: string;
  variant?: Variant;
  size?: "sm" | "md";
}

const successStatuses = ["published", "complete", "approved", "won"];
const warningStatuses = ["review", "scheduled", "in_progress", "drafting"];
const dangerStatuses = ["failed", "declined", "lost", "needs_update"];
const infoStatuses = ["planned", "new", "discovered"];

function detectVariant(status: string): Variant {
  const normalized = status.toLowerCase().replace(/\s+/g, "_");
  if (successStatuses.includes(normalized)) return "success";
  if (warningStatuses.includes(normalized)) return "warning";
  if (dangerStatuses.includes(normalized)) return "danger";
  if (infoStatuses.includes(normalized)) return "info";
  return "default";
}

const variantStyles: Record<Variant, string> = {
  default: "bg-zinc-700/50 text-zinc-300",
  success: "bg-lime-400/15 text-lime-400",
  warning: "bg-amber-500/15 text-amber-400",
  danger: "bg-red-500/15 text-red-400",
  info: "bg-blue-500/15 text-blue-400",
};

const sizeStyles: Record<"sm" | "md", string> = {
  sm: "text-[10px] px-1.5",
  md: "text-xs px-2 py-0.5",
};

export function StatusBadge({
  status,
  variant,
  size = "md",
}: StatusBadgeProps) {
  const resolvedVariant = variant ?? detectVariant(status);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium capitalize",
        variantStyles[resolvedVariant],
        sizeStyles[size]
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
