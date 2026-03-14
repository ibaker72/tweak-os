import { Badge } from "@/components/ui/badge";
import type { LifecycleStatus, EnrichmentStatus } from "@/lib/leads/types";

const lifecycleColors: Record<LifecycleStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  new: "info",
  contacted: "warning",
  qualified: "success",
  proposal: "default",
  won: "success",
  lost: "destructive",
  archived: "secondary",
};

const enrichmentColors: Record<EnrichmentStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  pending: "outline",
  in_progress: "warning",
  completed: "success",
  failed: "destructive",
};

export function LifecycleStatusBadge({ status }: { status: LifecycleStatus }) {
  return (
    <Badge variant={lifecycleColors[status]}>
      {status.replace("_", " ")}
    </Badge>
  );
}

export function EnrichmentStatusBadge({ status }: { status: EnrichmentStatus }) {
  return (
    <Badge variant={enrichmentColors[status]}>
      {status.replace("_", " ")}
    </Badge>
  );
}
