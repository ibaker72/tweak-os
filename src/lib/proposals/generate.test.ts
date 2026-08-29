import { describe, expect, it } from "vitest";
import { PROPOSAL_SYSTEM_PROMPT, buildProposalUserPrompt } from "./generate";
import { normalizeServices } from "./services";
import type { ProposalInput } from "./types";

function input(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    client_name: "Acme HVAC",
    business_type: "HVAC",
    website_url: "https://acme-hvac.com",
    selected_services: [],
    notes: "",
    ...overrides,
  };
}

describe("PROPOSAL_SYSTEM_PROMPT", () => {
  it("frames the work as custom-scoped rather than a fixed package", () => {
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(/custom-scoped/i);
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(/do not sell fixed, off-the-shelf packages/i);
  });

  it("forbids inventing or combining prices", () => {
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(/Never invent, estimate, round, discount/i);
    expect(PROPOSAL_SYSTEM_PROMPT).toMatch(
      /One-time and monthly amounts stay separate/i
    );
  });

  it("does not name any of the legacy packages", () => {
    for (const legacy of [
      "Foundation Website",
      "Growth Website System",
      "Premium Growth Package",
      "Ads Starter",
      "Growth Partnership",
    ]) {
      expect(PROPOSAL_SYSTEM_PROMPT).not.toContain(legacy);
    }
  });
});

describe("buildProposalUserPrompt", () => {
  const services = [
    {
      id: "custom-business-website",
      name: "Custom Business Website",
      one_time_price: 4800,
      description:
        "Up to 12 core pages, lead forms, service-area architecture, analytics setup.",
    },
    { id: "local-seo-city-pages", name: "Local SEO / City Pages", monthly_price: 750 },
  ];

  it("passes the exact service names and amounts through", () => {
    const prompt = buildProposalUserPrompt(input({ selected_services: services }));
    expect(prompt).toContain("1. Custom Business Website");
    expect(prompt).toContain("- One-time: $4,800");
    expect(prompt).toContain("2. Local SEO / City Pages");
    expect(prompt).toContain("- Monthly: $750/month");
  });

  it("includes the scope note when one was written", () => {
    const prompt = buildProposalUserPrompt(input({ selected_services: services }));
    expect(prompt).toContain(
      "Scope note: Up to 12 core pages, lead forms, service-area architecture, analytics setup."
    );
  });

  it("keeps the one-time and monthly totals separate", () => {
    const prompt = buildProposalUserPrompt(input({ selected_services: services }));
    expect(prompt).toContain("Total one-time: $4,800");
    expect(prompt).toContain("Monthly ongoing: $750/month");
    expect(prompt).not.toContain("$5,550");
  });

  it("hands the model a pre-built investment block to reproduce verbatim", () => {
    const prompt = buildProposalUserPrompt(input({ selected_services: services }));
    expect(prompt).toMatch(/Reproduce the following block EXACTLY/);
    expect(prompt).toContain("| Custom Business Website | $4,800 | — |");
    expect(prompt).toContain("| Local SEO / City Pages | — | $750/month |");
    expect(prompt).toContain("**Total One-Time Investment:** $4,800");
    expect(prompt).toContain("**Monthly Ongoing Investment:** $750/month");
  });

  it("reports a service with both amounts in both buckets", () => {
    const prompt = buildProposalUserPrompt(
      input({
        selected_services: [
          { name: "Local Growth System", one_time_price: 6500, monthly_price: 800 },
        ],
      })
    );
    expect(prompt).toContain("- One-time: $6,500");
    expect(prompt).toContain("- Monthly: $800/month");
    expect(prompt).toContain("Total one-time: $6,500");
    expect(prompt).toContain("Monthly ongoing: $800/month");
  });

  it("says a service is unpriced instead of inventing an amount", () => {
    const prompt = buildProposalUserPrompt(
      input({ selected_services: [{ name: "Drone Photography / Video" }] })
    );
    expect(prompt).toContain("- One-time: none");
    expect(prompt).toContain("- Monthly: none");
  });

  it("carries a legacy payload's amounts through unchanged once normalized", () => {
    // What the generate route does with an older client's payload.
    const legacy = normalizeServices([
      { name: "Premium Growth Package", price: 8500, billing: "one-time" },
      { name: "Growth Partnership", price: 4500, billing: "monthly" },
    ]);
    const prompt = buildProposalUserPrompt(input({ selected_services: legacy }));
    expect(prompt).toContain("1. Premium Growth Package");
    expect(prompt).toContain("- One-time: $8,500");
    expect(prompt).toContain("2. Growth Partnership");
    expect(prompt).toContain("- Monthly: $4,500/month");
    expect(prompt).toContain("Total one-time: $8,500");
    expect(prompt).toContain("Monthly ongoing: $4,500/month");
  });

  it("handles an empty scope without pretending anything was selected", () => {
    const prompt = buildProposalUserPrompt(input());
    expect(prompt).toContain("(no scope selected yet)");
    expect(prompt).toMatch(/discovery call/i);
  });
});
