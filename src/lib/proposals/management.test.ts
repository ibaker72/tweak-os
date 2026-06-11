import { describe, expect, it } from "vitest";
import {
  findObsoletableLaunchKitIds,
  proposalIsLaunchKit,
  type ManagedProposalRow,
} from "./management";

const LEAD_ID = "00000000-0000-0000-0000-000000000001";

function row(overrides: Partial<ManagedProposalRow>): ManagedProposalRow {
  return {
    id: overrides.id ?? "row-" + Math.random().toString(36).slice(2),
    lead_id: overrides.lead_id ?? LEAD_ID,
    status: overrides.status ?? "draft",
    services_json:
      "services_json" in overrides
        ? overrides.services_json
        : [
            { name: "New Business Launch Kit", price: 2500, billing: "one-time" },
          ],
    client_name: overrides.client_name ?? "Acme LLC",
    created_at: overrides.created_at ?? "2026-06-01T00:00:00Z",
  };
}

describe("proposalIsLaunchKit", () => {
  it("recognizes Launch Kit proposals from their services payload", () => {
    expect(proposalIsLaunchKit(row({}))).toBe(true);
  });

  it("returns false when no service line mentions Launch Kit / New Business", () => {
    expect(
      proposalIsLaunchKit(
        row({
          services_json: [
            { name: "Foundation Website", price: 3500, billing: "one-time" },
          ],
        })
      )
    ).toBe(false);
  });

  it("returns false when services_json is missing", () => {
    expect(proposalIsLaunchKit(row({ services_json: null }))).toBe(false);
  });
});

describe("findObsoletableLaunchKitIds", () => {
  it("marks older Launch Kit proposals on the same lead as obsolete", () => {
    const newer = row({ id: "new", status: "active" });
    const older = row({ id: "old", status: "draft" });
    const ids = findObsoletableLaunchKitIds({
      activatedRow: newer,
      allRows: [newer, older],
    });
    expect(ids).toEqual(["old"]);
  });

  it("never returns the activated row itself", () => {
    const activated = row({ id: "self", status: "active" });
    const ids = findObsoletableLaunchKitIds({
      activatedRow: activated,
      allRows: [activated],
    });
    expect(ids).toEqual([]);
  });

  it("skips proposals already obsolete or archived", () => {
    const newer = row({ id: "new", status: "active" });
    const obsolete = row({ id: "old-obs", status: "obsolete" });
    const archived = row({ id: "old-arch", status: "archived" });
    const ids = findObsoletableLaunchKitIds({
      activatedRow: newer,
      allRows: [newer, obsolete, archived],
    });
    expect(ids).toEqual([]);
  });

  it("ignores proposals for other leads", () => {
    const newer = row({ id: "new", status: "active" });
    const otherLead = row({
      id: "other",
      status: "draft",
      lead_id: "different-lead-id",
    });
    const ids = findObsoletableLaunchKitIds({
      activatedRow: newer,
      allRows: [newer, otherLead],
    });
    expect(ids).toEqual([]);
  });

  it("ignores non-Launch-Kit proposals on the same lead", () => {
    const newer = row({ id: "new", status: "active" });
    const foundation = row({
      id: "found",
      status: "draft",
      services_json: [
        { name: "Foundation Website", price: 3500, billing: "one-time" },
      ],
    });
    const ids = findObsoletableLaunchKitIds({
      activatedRow: newer,
      allRows: [newer, foundation],
    });
    expect(ids).toEqual([]);
  });

  it("returns empty when the activated proposal itself is not a Launch Kit", () => {
    const activated = row({
      id: "active",
      status: "active",
      services_json: [
        { name: "Foundation Website", price: 3500, billing: "one-time" },
      ],
    });
    const older = row({ id: "old", status: "draft" });
    const ids = findObsoletableLaunchKitIds({
      activatedRow: activated,
      allRows: [activated, older],
    });
    expect(ids).toEqual([]);
  });
});
