import { describe, it, expect } from "vitest";
import {
  decisionMarginDays,
  findConflicts,
  isLive,
  rankClaims,
  validateOverride,
  type AttributionRow,
} from "./attribution";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function claim(overrides: Partial<AttributionRow> = {}): AttributionRow {
  return {
    id: "attr-1",
    agent_id: "agent-a",
    lead_id: "lead-1",
    source: "self_sourced",
    first_touch_at: "2026-05-01T00:00:00.000Z",
    expires_at: "2026-07-30T00:00:00.000Z",
    resolved_at: null,
    is_override: false,
    override_reason: null,
    override_by: null,
    ...overrides,
  };
}

describe("isLive", () => {
  it("is true for an unresolved, unexpired claim", () => {
    expect(isLive(claim(), NOW)).toBe(true);
  });

  it("is false once resolved", () => {
    expect(isLive(claim({ resolved_at: "2026-05-20T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("is false once expired", () => {
    expect(isLive(claim({ expires_at: "2026-05-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("is true for an expired claim carrying an override", () => {
    // An admin decision outlives the 90-day window.
    expect(
      isLive(
        claim({ expires_at: "2026-01-01T00:00:00.000Z", is_override: true }),
        NOW
      )
    ).toBe(true);
  });

  it("treats a null expiry as never expiring", () => {
    expect(isLive(claim({ expires_at: null }), NOW)).toBe(true);
  });
});

describe("rankClaims", () => {
  it("puts an override first regardless of timing", () => {
    const ranked = rankClaims([
      claim({ id: "old", agent_id: "agent-a", first_touch_at: "2026-01-01T00:00:00.000Z" }),
      claim({
        id: "override",
        agent_id: "agent-b",
        first_touch_at: "2026-05-20T00:00:00.000Z",
        is_override: true,
      }),
    ]);
    expect(ranked[0].id).toBe("override");
  });

  it("otherwise the earliest first touch wins", () => {
    const ranked = rankClaims([
      claim({ id: "later", first_touch_at: "2026-05-20T00:00:00.000Z" }),
      claim({ id: "earlier", first_touch_at: "2026-05-01T00:00:00.000Z" }),
    ]);
    expect(ranked[0].id).toBe("earlier");
  });

  it("breaks an exact tie by id, so the order is stable", () => {
    // Without a total order, the winner could change between the admin
    // previewing the conflict and the conversion that resolves it.
    const rows = [
      claim({ id: "bbb", agent_id: "agent-b" }),
      claim({ id: "aaa", agent_id: "agent-a" }),
    ];
    expect(rankClaims(rows)[0].id).toBe("aaa");
    expect(rankClaims([...rows].reverse())[0].id).toBe("aaa");
  });

  it("does not mutate its input", () => {
    const rows = [
      claim({ id: "later", first_touch_at: "2026-05-20T00:00:00.000Z" }),
      claim({ id: "earlier", first_touch_at: "2026-05-01T00:00:00.000Z" }),
    ];
    rankClaims(rows);
    expect(rows[0].id).toBe("later");
  });
});

describe("findConflicts", () => {
  it("finds a lead two agents both claim", () => {
    const conflicts = findConflicts(
      [
        claim({ id: "1", agent_id: "agent-a" }),
        claim({ id: "2", agent_id: "agent-b", first_touch_at: "2026-05-10T00:00:00.000Z" }),
      ],
      NOW
    );

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].agentCount).toBe(2);
    expect(conflicts[0].winner.agent_id).toBe("agent-a");
  });

  it("does not flag several claims from the same agent", () => {
    // One agent touching a lead twice is not a dispute, and surfacing it would
    // bury the real conflicts.
    const conflicts = findConflicts(
      [
        claim({ id: "1", agent_id: "agent-a", source: "referral_link" }),
        claim({ id: "2", agent_id: "agent-a", source: "manual_intro" }),
      ],
      NOW
    );
    expect(conflicts).toHaveLength(0);
  });

  it("ignores expired and resolved claims", () => {
    const conflicts = findConflicts(
      [
        claim({ id: "1", agent_id: "agent-a" }),
        claim({ id: "2", agent_id: "agent-b", expires_at: "2026-01-01T00:00:00.000Z" }),
        claim({ id: "3", agent_id: "agent-c", resolved_at: "2026-05-01T00:00:00.000Z" }),
      ],
      NOW
    );
    expect(conflicts).toHaveLength(0);
  });

  it("marks a conflict already settled by an override", () => {
    const conflicts = findConflicts(
      [
        claim({ id: "1", agent_id: "agent-a", first_touch_at: "2026-01-01T00:00:00.000Z" }),
        claim({
          id: "2",
          agent_id: "agent-b",
          is_override: true,
          override_reason: "Agent B ran the whole cycle",
          override_by: "admin",
        }),
      ],
      NOW
    );
    expect(conflicts[0].decidedByOverride).toBe(true);
    expect(conflicts[0].winner.agent_id).toBe("agent-b");
  });

  it("sorts the most contested leads first", () => {
    const conflicts = findConflicts(
      [
        claim({ id: "1", lead_id: "two-way", agent_id: "agent-a" }),
        claim({ id: "2", lead_id: "two-way", agent_id: "agent-b" }),
        claim({ id: "3", lead_id: "three-way", agent_id: "agent-a" }),
        claim({ id: "4", lead_id: "three-way", agent_id: "agent-b" }),
        claim({ id: "5", lead_id: "three-way", agent_id: "agent-c" }),
      ],
      NOW
    );
    expect(conflicts[0].leadId).toBe("three-way");
    expect(conflicts[0].agentCount).toBe(3);
  });

  it("returns nothing for an empty set", () => {
    expect(findConflicts([], NOW)).toEqual([]);
  });
});

describe("decisionMarginDays", () => {
  it("reports how close the top two claims were", () => {
    const [conflict] = findConflicts(
      [
        claim({ id: "1", agent_id: "agent-a", first_touch_at: "2026-05-01T00:00:00.000Z" }),
        claim({ id: "2", agent_id: "agent-b", first_touch_at: "2026-05-03T00:00:00.000Z" }),
      ],
      NOW
    );
    expect(decisionMarginDays(conflict)).toBe(2);
  });

  it("is zero when two claims land the same day — the ones worth a human look", () => {
    const [conflict] = findConflicts(
      [
        claim({ id: "1", agent_id: "agent-a", first_touch_at: "2026-05-01T09:00:00.000Z" }),
        claim({ id: "2", agent_id: "agent-b", first_touch_at: "2026-05-01T15:00:00.000Z" }),
      ],
      NOW
    );
    expect(decisionMarginDays(conflict)).toBe(0);
  });

  it("is null when an override settled it, since the margin is irrelevant", () => {
    const [conflict] = findConflicts(
      [
        claim({ id: "1", agent_id: "agent-a", first_touch_at: "2026-01-01T00:00:00.000Z" }),
        claim({ id: "2", agent_id: "agent-b", is_override: true }),
      ],
      NOW
    );
    expect(decisionMarginDays(conflict)).toBeNull();
  });
});

describe("validateOverride", () => {
  const base = { leadId: "lead-1", agentId: "agent-a", overrideBy: "admin-1" };

  it("accepts a real reason", () => {
    expect(
      validateOverride({ ...base, reason: "Agent B sourced and ran the entire cycle" })
    ).toEqual({ ok: true });
  });

  it("rejects an empty or whitespace-only reason", () => {
    expect(validateOverride({ ...base, reason: "" }).ok).toBe(false);
    expect(validateOverride({ ...base, reason: "    " }).ok).toBe(false);
  });

  it("rejects a token reason", () => {
    // "x" recorded as justification looks like process was followed when it
    // was not, which is worse than no record at all.
    const result = validateOverride({ ...base, reason: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/real reason/);
  });

  it("rejects an absurdly long reason", () => {
    expect(validateOverride({ ...base, reason: "a".repeat(2001) }).ok).toBe(false);
  });

  it("accepts a reason exactly at the minimum length", () => {
    expect(validateOverride({ ...base, reason: "1234567890" }).ok).toBe(true);
  });
});
