import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Structural assertions about the Proposal Generator surface. There is no DOM
 * renderer in this project, so these read the source — enough for the
 * properties that matter here, all of which are about what the page sends,
 * what it pre-fills, and what it refuses to pre-fill.
 */

const SRC = path.resolve(__dirname, "../..");
const page = readFileSync(
  path.join(SRC, "app/(platform)/proposals/ProposalsPageInner.tsx"),
  "utf8"
);
const picker = readFileSync(path.join(SRC, "components/proposals/LeadPicker.tsx"), "utf8");
const leadPage = readFileSync(path.join(SRC, "app/(platform)/leads/[id]/page.tsx"), "utf8");

describe("the Proposal Generator page", () => {
  it("leads with the lead picker and keeps Recent Proposals behind the other tab", () => {
    expect(page).toContain("Start from a Lead");
    expect(page).toContain("<LeadPicker");
    expect(page).toContain('useState<"lead" | "recent">("lead")');

    // Recent Proposals still exists, and its table still renders.
    expect(page).toContain("Recent Proposals");
    expect(page).toContain("<ProposalRow");
    // ...but only on its own tab, not above the builder.
    expect(page).toContain('topTab === "lead" ? (');
    expect(page.indexOf("<LeadPicker")).toBeLessThan(page.indexOf("<ProposalRow"));
  });

  it("persists the selected lead on both the save and the generate call", () => {
    const bodies = [...page.matchAll(/lead_id: ([^,\n]+)/g)].map((m) => m[1].trim());
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const value of bodies) {
      expect(value).toBe("leadId ?? undefined");
    }
  });

  it("pre-fills client identity from the lead and nothing about scope or price", () => {
    const prefill = page.slice(
      page.indexOf("function applyLeadPrefill"),
      page.indexOf("function selectLead")
    );
    expect(prefill).toContain("setClientName");
    expect(prefill).toContain("setBusinessType");
    expect(prefill).toContain("setWebsiteUrl");
    expect(prefill).toContain("setRecipientEmail");
    for (const forbidden of ["setSelectedServices", "setSections", "one_time_price", "monthly_price"]) {
      expect(prefill, `${forbidden} must not be pre-filled from a lead`).not.toContain(
        forbidden
      );
    }
  });

  it("keeps a proposal's existing lead when it is reopened for editing", () => {
    const edit = page.slice(page.indexOf("function editProposal"), page.indexOf("const selectedCatalogIds"));
    expect(edit).toContain("setLeadId(proposal.lead_id ?? null)");
  });

  it("can still be used with no lead at all", () => {
    // The link is optional in the builder and removable once made.
    expect(page).toContain("function unlinkLead");
    expect(page).toContain("{leadId && (");
    expect(page).toContain('useState<string | null>(presetLeadId ?? null)');
  });

  it("warns about existing proposals without blocking a new one", () => {
    expect(page).toContain("existingProposalLabel");
    expect(page).toContain("you can still create");
  });
});

describe("the lead picker", () => {
  it("asks the server for a bounded list and searches server-side", () => {
    expect(picker).toContain("/api/proposals/leads?");
    expect(picker).toContain("limit: String(LEAD_PICKER_LIMIT_DEFAULT)");
    expect(picker).toContain("params.set(\"q\", search)");
    expect(picker).toContain("SEARCH_DEBOUNCE_MS");
  });

  it("never fetches the whole leads table into the browser", () => {
    expect(picker).not.toContain("/api/leads?");
    expect(picker).not.toContain("per_page");
  });

  it("offers one primary action per lead", () => {
    expect(picker).toContain("Create Proposal");
    expect([...picker.matchAll(/<Button/g)]).toHaveLength(1);
  });
});

describe("the lead detail page", () => {
  it("shows this lead's proposals and links a new one to it", () => {
    expect(leadPage).toContain("<LeadProposals");
    expect(leadPage).toContain('.eq("lead_id", id)');
  });
});
