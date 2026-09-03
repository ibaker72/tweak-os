import { describe, it, expect } from "vitest";
import {
  buildLeadSearchFilter,
  buildProposalPrefill,
  businessTypeForLead,
  decorateCandidates,
  rankLeadCandidates,
  sanitizeLeadSearchTerm,
  summarizeProposalsByLead,
  LEAD_PICKER_LIMIT_DEFAULT,
  LEAD_SEARCH_COLUMNS,
  type CandidateBucket,
  type LeadCandidateRow,
} from "./lead-candidates";

function lead(id: string, extra: Partial<LeadCandidateRow> = {}): LeadCandidateRow {
  return { id, business_name: `Lead ${id}`, ...extra };
}

describe("rankLeadCandidates", () => {
  it("orders buckets by usefulness, not by the order they were passed", () => {
    const buckets: CandidateBucket[] = [
      { reason: "hot", rows: [lead("hot-1")] },
      { reason: "recent", rows: [lead("recent-1")] },
      { reason: "follow_up_due", rows: [lead("due-1")] },
      { reason: "engaged", rows: [lead("engaged-1")] },
    ];

    expect(rankLeadCandidates(buckets).map((r) => r.id)).toEqual([
      "due-1",
      "engaged-1",
      "hot-1",
      "recent-1",
    ]);
  });

  it("keeps each bucket's own database ordering", () => {
    const buckets: CandidateBucket[] = [
      { reason: "hot", rows: [lead("a"), lead("b"), lead("c")] },
    ];
    expect(rankLeadCandidates(buckets).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("shows a lead once, under its strongest reason", () => {
    const shared = lead("shared");
    const ranked = rankLeadCandidates([
      { reason: "hot", rows: [shared] },
      { reason: "follow_up_due", rows: [shared] },
      { reason: "recent", rows: [shared] },
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].reason).toBe("follow_up_due");
  });

  it("caps the list — the picker never renders the whole CRM", () => {
    const rows = Array.from({ length: 40 }, (_, i) => lead(`lead-${i}`));
    expect(rankLeadCandidates([{ reason: "recent", rows }])).toHaveLength(
      LEAD_PICKER_LIMIT_DEFAULT
    );
    expect(rankLeadCandidates([{ reason: "recent", rows }], 3)).toHaveLength(3);
  });

  it("ignores rows with no id rather than rendering a broken row", () => {
    const ranked = rankLeadCandidates([
      { reason: "hot", rows: [{ id: "", business_name: "Nameless" }, lead("ok")] },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("lead search filter", () => {
  it("searches every field an agent might have to hand", () => {
    const filter = buildLeadSearchFilter("acme");
    for (const column of LEAD_SEARCH_COLUMNS) {
      expect(filter).toContain(`${column}.ilike.%acme%`);
    }
  });

  it("refuses a term too short to be worth a query", () => {
    expect(buildLeadSearchFilter("a")).toBeNull();
    expect(buildLeadSearchFilter("  ")).toBeNull();
    expect(buildLeadSearchFilter("ac")).not.toBeNull();
  });

  it("strips characters that would break out of the PostgREST filter", () => {
    expect(sanitizeLeadSearchTerm(`ac,me)(or"x'\\`)).toBe("ac me or x");
    const filter = buildLeadSearchFilter("acme,website.ilike.%");
    expect(filter).not.toBeNull();
    // The injected operator survives only as literal text inside one pattern.
    expect(filter!.split(",")).toHaveLength(LEAD_SEARCH_COLUMNS.length);
  });

  it("drops the LIKE wildcard so a search cannot match everything", () => {
    expect(buildLeadSearchFilter("100%")).toBe(
      LEAD_SEARCH_COLUMNS.map((c) => `${c}.ilike.%100%`).join(",")
    );
  });

  it("keeps punctuation that is part of real contact details", () => {
    expect(sanitizeLeadSearchTerm("first_last@acme-hvac.com")).toBe(
      "first_last@acme-hvac.com"
    );
    expect(sanitizeLeadSearchTerm("(973) 555-0100")).toBe("973 555-0100");
  });
});

describe("summarizeProposalsByLead", () => {
  const rows = [
    { id: "p1", lead_id: "lead-a", status: "draft", created_at: "2026-09-01T00:00:00Z", total_one_time: 2500, total_monthly: 0 },
    { id: "p2", lead_id: "lead-a", status: "sent", created_at: "2026-09-03T00:00:00Z", total_one_time: 3500, total_monthly: 500 },
    { id: "p3", lead_id: "lead-b", status: "won", created_at: "2026-08-01T00:00:00Z", total_one_time: 1000, total_monthly: 0 },
  ];

  it("counts every proposal for a lead — multiples are allowed", () => {
    const summary = summarizeProposalsByLead(rows);
    expect(summary.get("lead-a")?.count).toBe(2);
    expect(summary.get("lead-b")?.count).toBe(1);
  });

  it("reports the newest proposal as the one to show", () => {
    expect(summarizeProposalsByLead(rows).get("lead-a")?.latest?.id).toBe("p2");
  });

  it("skips proposals with no lead — those are the manual ones", () => {
    const summary = summarizeProposalsByLead([
      { id: "orphan", lead_id: null, status: "saved", created_at: "2026-09-02T00:00:00Z" },
    ]);
    expect(summary.size).toBe(0);
  });

  it("coerces numeric strings, which is what Postgres numerics arrive as", () => {
    const summary = summarizeProposalsByLead([
      { id: "p", lead_id: "l", status: "saved", created_at: "2026-09-02T00:00:00Z", total_one_time: "2500", total_monthly: "500" },
    ]);
    expect(summary.get("l")?.latest?.total_one_time).toBe(2500);
    expect(summary.get("l")?.latest?.total_monthly).toBe(500);
  });
});

describe("decorateCandidates", () => {
  it("marks leads that already have proposals", () => {
    const decorated = decorateCandidates(
      [{ ...lead("l1"), reason: "hot" }, { ...lead("l2"), reason: "hot" }],
      summarizeProposalsByLead([
        { id: "p1", lead_id: "l1", status: "draft", created_at: "2026-09-03T00:00:00Z" },
      ])
    );

    expect(decorated[0].proposal_count).toBe(1);
    expect(decorated[0].latest_proposal?.status).toBe("draft");
    expect(decorated[1].proposal_count).toBe(0);
    expect(decorated[1].latest_proposal).toBeNull();
  });

  it("resolves the assigned partner's name when the directory has one", () => {
    const decorated = decorateCandidates(
      [{ ...lead("l1", { assigned_to: "agent-1" }), reason: "hot" }, { ...lead("l2"), reason: "hot" }],
      new Map(),
      new Map([["agent-1", "Dana"]])
    );
    expect(decorated[0].assigned_to_name).toBe("Dana");
    expect(decorated[1].assigned_to_name).toBeNull();
  });
});

describe("businessTypeForLead", () => {
  it("reads the industry off the CRM fields", () => {
    expect(businessTypeForLead(lead("1", { niche: "HVAC" }))).toBe("HVAC");
    expect(businessTypeForLead(lead("2", { category: "roofing contractor" }))).toBe("Roofing");
    expect(
      businessTypeForLead(lead("3", { business_name: "Bergen Garage Door Co" }))
    ).toBe("Garage Door Contractor");
  });

  it("prefers the niche over a keyword hidden in the business name", () => {
    expect(
      businessTypeForLead(lead("4", { niche: "Plumbing", business_name: "Roof Street Plumbers" }))
    ).toBe("Plumbing");
  });

  it("falls back to the dropdown's existing default", () => {
    expect(businessTypeForLead(lead("5"))).toBe("Home Services");
    expect(businessTypeForLead(lead("6", { niche: "Widget Wholesaler" }))).toBe(
      "Home Services"
    );
  });
});

describe("buildProposalPrefill", () => {
  const source = lead("lead-1", {
    business_name: "  Acme HVAC  ",
    website: "https://acme-hvac.com",
    email: "owner@acme-hvac.com",
    phone: "973-555-0100",
    contact_name: "Dana Reed",
    niche: "HVAC",
    city: "Newark",
    state: "NJ",
  });

  it("carries the client's identity across from the lead", () => {
    expect(buildProposalPrefill(source)).toEqual({
      lead_id: "lead-1",
      client_name: "Acme HVAC",
      business_type: "HVAC",
      website_url: "https://acme-hvac.com",
      recipient_name: "Dana Reed",
      recipient_email: "owner@acme-hvac.com",
      phone: "973-555-0100",
    });
  });

  it("carries nothing about scope or price", () => {
    const prefill = buildProposalPrefill(source) as unknown as Record<string, unknown>;
    for (const key of ["services", "selected_services", "total_one_time", "total_monthly", "price"]) {
      expect(prefill[key]).toBeUndefined();
    }
  });

  it("copes with a lead that has almost nothing on it", () => {
    const prefill = buildProposalPrefill({ id: "bare", business_name: null });
    expect(prefill).toEqual({
      lead_id: "bare",
      client_name: "",
      business_type: "Home Services",
      website_url: "",
      recipient_name: "",
      recipient_email: "",
      phone: "",
    });
  });
});
