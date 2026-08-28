/**
 * Attribution conflict detection — pure.
 *
 * A conflict is a lead with more than one live claim on it from different
 * agents. Those are the rows where two people both believe they are owed the
 * commission, and where the answer needs to be decided deliberately rather
 * than by whichever query happened to sort first.
 *
 * The tie-break is the documented one, applied here and in
 * convert_lead_to_account() identically: an admin override wins outright,
 * otherwise the earliest non-expired first touch.
 */

export type AttributionSource =
  | "referral_link"
  | "manual_intro"
  | "self_sourced"
  | "inbound_assigned";

export interface AttributionRow {
  id: string;
  agent_id: string;
  lead_id: string;
  source: AttributionSource;
  first_touch_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  is_override: boolean;
  override_reason: string | null;
  override_by: string | null;
}

export interface AttributionConflict {
  leadId: string;
  claims: AttributionRow[];
  /** The row that would win today if the lead converted now. */
  winner: AttributionRow;
  /** True when the winner won because an admin said so, not by timing. */
  decidedByOverride: boolean;
  /** Distinct agents with a live claim. Always 2 or more for a conflict. */
  agentCount: number;
}

/** Live means unresolved and either overridden or not yet expired. */
export function isLive(row: AttributionRow, now: Date = new Date()): boolean {
  if (row.resolved_at !== null) return false;
  if (row.is_override) return true;
  if (row.expires_at === null) return true;
  return new Date(row.expires_at) > now;
}

/**
 * Rank live claims. First element is the winner.
 *
 * Overrides first, then earliest first touch. Ties on both fall back to the
 * row id so the order is total and stable — an unstable ordering here would
 * mean the winner could change between the admin previewing a conflict and
 * the conversion that resolves it.
 */
export function rankClaims(claims: AttributionRow[]): AttributionRow[] {
  return [...claims].sort((a, b) => {
    if (a.is_override !== b.is_override) return a.is_override ? -1 : 1;
    const touch = a.first_touch_at.localeCompare(b.first_touch_at);
    if (touch !== 0) return touch;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Leads where two or more agents hold a live claim.
 *
 * Several claims from the *same* agent are not a conflict — an agent who
 * touched a lead by referral link and again by manual intro is still the only
 * candidate, and surfacing that as something to resolve would bury the real
 * conflicts in noise.
 */
export function findConflicts(
  rows: AttributionRow[],
  now: Date = new Date()
): AttributionConflict[] {
  const byLead = new Map<string, AttributionRow[]>();

  for (const row of rows) {
    if (!isLive(row, now)) continue;
    const list = byLead.get(row.lead_id);
    if (list) list.push(row);
    else byLead.set(row.lead_id, [row]);
  }

  const conflicts: AttributionConflict[] = [];

  for (const [leadId, claims] of byLead) {
    const agents = new Set(claims.map((c) => c.agent_id));
    if (agents.size < 2) continue;

    const ranked = rankClaims(claims);
    conflicts.push({
      leadId,
      claims: ranked,
      winner: ranked[0],
      decidedByOverride: ranked[0].is_override,
      agentCount: agents.size,
    });
  }

  // Contested-by-most first, then oldest, so the ones most likely to become an
  // argument surface at the top.
  return conflicts.sort((a, b) => {
    if (a.agentCount !== b.agentCount) return b.agentCount - a.agentCount;
    return a.winner.first_touch_at.localeCompare(b.winner.first_touch_at);
  });
}

/**
 * How close the decision was, in whole days between the top two claims.
 *
 * A conflict decided by six hours deserves a human look; one decided by two
 * months does not. Null when an override settled it, since the margin is then
 * irrelevant.
 */
export function decisionMarginDays(conflict: AttributionConflict): number | null {
  if (conflict.decidedByOverride) return null;
  const [first, second] = conflict.claims;
  if (!second) return null;
  const ms =
    new Date(second.first_touch_at).getTime() - new Date(first.first_touch_at).getTime();
  return Math.floor(ms / 86_400_000);
}

export interface OverrideRequest {
  leadId: string;
  agentId: string;
  reason: string;
  overrideBy: string;
}

export type OverrideValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * A written reason is required, and "because" is not one.
 *
 * The database enforces non-blank; this adds a length floor, because an
 * override recorded as "x" is worse than no record — it looks like process was
 * followed when it was not.
 */
export function validateOverride(input: OverrideRequest): OverrideValidation {
  const reason = input.reason.trim();
  if (reason.length === 0) {
    return { ok: false, error: "An override needs a written reason" };
  }
  if (reason.length < 10) {
    return {
      ok: false,
      error: "Give a real reason — this is the record if the split is ever disputed",
    };
  }
  if (reason.length > 2000) {
    return { ok: false, error: "Reason is too long (2000 characters max)" };
  }
  return { ok: true };
}
