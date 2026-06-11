import type { ProposalStatus } from "./types";
import { isLaunchKitPackage } from "./pricing";

/**
 * Status values an OpenClaw caller may move a proposal into via PATCH.
 * The internal "draft / saved / sent / won / lost" states stay editable
 * through the existing /api/proposals route; OpenClaw only drives the
 * lifecycle states it needs.
 */
export const MANAGED_PROPOSAL_STATUSES = [
  "draft",
  "active",
  "obsolete",
  "archived",
] as const;
export type ManagedProposalStatus = (typeof MANAGED_PROPOSAL_STATUSES)[number];

export const ARCHIVED_STATUS: ProposalStatus = "archived";
export const OBSOLETE_STATUS: ProposalStatus = "obsolete";
export const ACTIVE_STATUS: ProposalStatus = "active";

/** Statuses considered "hidden" — UI mutes them and they cannot be the active proposal. */
export const HIDDEN_STATUSES: ReadonlySet<ProposalStatus> = new Set([
  "obsolete",
  "archived",
  "lost",
]);

export interface ManagedProposalRow {
  id: string;
  lead_id: string | null;
  status: ProposalStatus | string;
  services_json: unknown;
  client_name?: string | null;
  created_at: string;
}

interface ServiceLike {
  name?: unknown;
}

/**
 * Decide whether a proposal row pitches the Launch Kit. We check the
 * services payload because OpenClaw stores the package in the line items
 * (the "name" field of the one-time line), not in a dedicated column.
 */
export function proposalIsLaunchKit(row: ManagedProposalRow): boolean {
  const services = Array.isArray(row.services_json)
    ? (row.services_json as ServiceLike[])
    : [];
  return services.some((s) => {
    const name = typeof s?.name === "string" ? s.name : "";
    return name && isLaunchKitPackage(name);
  });
}

/**
 * Given the full set of proposals for a lead and the proposal that was
 * just marked active, return the ids of older Launch Kit proposals that
 * should now be marked obsolete. We never demote the row that was just
 * activated, and we never touch already-archived or already-obsolete
 * rows — those keep their stronger lifecycle state.
 */
export function findObsoletableLaunchKitIds(args: {
  activatedRow: ManagedProposalRow;
  allRows: ManagedProposalRow[];
}): string[] {
  const { activatedRow, allRows } = args;
  if (!proposalIsLaunchKit(activatedRow)) return [];

  const ids: string[] = [];
  for (const row of allRows) {
    if (row.id === activatedRow.id) continue;
    if (row.lead_id !== activatedRow.lead_id) continue;
    if (row.status === "obsolete" || row.status === "archived") continue;
    if (!proposalIsLaunchKit(row)) continue;
    ids.push(row.id);
  }
  return ids;
}
