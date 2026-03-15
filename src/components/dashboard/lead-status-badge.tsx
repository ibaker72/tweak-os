import { Badge } from "@/components/ui/badge";
import type { LifecycleStatus, EnrichmentStatus } from "@/lib/leads/types";

const lifecycleColors: Record<LifecycleStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  new: "info",
  enriched: "default",
  contacted: "warning",
  replied: "success",
  meeting_booked: "success",
  won: "success",
  lost: "destructive",
  not_a_fit: "secondary",
};

const enrichmentColors: Record<EnrichmentStatus, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"> = {
  pending: "outline",
  crawling: "warning",
  complete: "success",
  failed: "destructive",
};

export function LifecycleStatusBadge({ status }: { status: LifecycleStatus }) {
  return (
    <Badge variant={lifecycleColors[status] ?? "outline"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function EnrichmentStatusBadge({ status }: { status: EnrichmentStatus }) {
  return (
    <Badge variant={enrichmentColors[status] ?? "outline"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
