import { describe, expect, it } from "vitest";
import {
  buildDefaultSections,
  parseSectionsFromMarkdown,
  sectionsToMarkdown,
  sectionsToPlainText,
  slugifyClient,
  softenLeadLossClaim,
  softenSummary,
} from "./sections";
import type { AuditJson } from "@/lib/audits/types";

describe("parseSectionsFromMarkdown", () => {
  it("returns empty sections when input is empty", () => {
    const result = parseSectionsFromMarkdown("");
    expect(result.executive_summary).toBe("");
    expect(result.what_we_found).toBe("");
  });

  it("splits a full markdown proposal into the seven sections", () => {
    const md = [
      "## Executive Summary",
      "Acme HVAC is well-positioned in their market.",
      "",
      "## What We Found",
      "- Missing local SEO pages",
      "- No structured data",
      "",
      "## Our Recommendation",
      "Build the Growth Website System.",
      "",
      "## Investment Summary",
      "| Service | Price | Billing |",
      "| --- | --- | --- |",
      "| Growth Website | $6,500 | One-time |",
      "",
      "## What Happens Next",
      "1. Discovery call",
      "2. Build",
      "3. Launch",
      "",
      "## About Tweak & Build",
      "Founder-led studio in New Jersey.",
      "",
      "## Custom Notes",
      "Lead wants launch before Q3.",
    ].join("\n");
    const result = parseSectionsFromMarkdown(md);
    expect(result.executive_summary).toBe("Acme HVAC is well-positioned in their market.");
    expect(result.what_we_found).toContain("- Missing local SEO pages");
    expect(result.our_recommendation).toBe("Build the Growth Website System.");
    expect(result.investment_summary).toContain("| Service | Price | Billing |");
    expect(result.what_happens_next).toContain("1. Discovery call");
    expect(result.about).toBe("Founder-led studio in New Jersey.");
    expect(result.custom_notes).toBe("Lead wants launch before Q3.");
  });

  it("roundtrips through sectionsToMarkdown", () => {
    const md = [
      "## Executive Summary",
      "Summary text.",
      "",
      "## Our Recommendation",
      "Recommendation text.",
    ].join("\n");
    const sections = parseSectionsFromMarkdown(md);
    const back = sectionsToMarkdown(sections);
    expect(back).toContain("## Executive Summary");
    expect(back).toContain("Summary text.");
    expect(back).toContain("## Our Recommendation");
  });

  it("omits empty sections from the rendered markdown", () => {
    const md = "## Executive Summary\nHello.";
    const sections = parseSectionsFromMarkdown(md);
    const out = sectionsToMarkdown(sections);
    expect(out).toContain("## Executive Summary");
    expect(out).not.toContain("## About Tweak & Build");
  });

  it("strips markdown when producing plain text", () => {
    const md = "## Executive Summary\nThis is **bold** and *italic*.";
    const sections = parseSectionsFromMarkdown(md);
    const txt = sectionsToPlainText(sections);
    expect(txt).toContain("EXECUTIVE SUMMARY");
    expect(txt).toContain("This is bold and italic.");
    expect(txt).not.toContain("**");
  });
});

describe("softenLeadLossClaim", () => {
  it("returns conservative phrasing for low-scoring audits", () => {
    const audit = { overall_score: 30, opportunity_grade: "C" as const };
    const claim = softenLeadLossClaim(audit);
    expect(claim).toMatch(/strong opportunity/i);
    expect(claim).not.toMatch(/\d+ leads/);
  });

  it("escalates for mid-range scores", () => {
    const audit = { overall_score: 60, opportunity_grade: "B" as const };
    const claim = softenLeadLossClaim(audit);
    expect(claim).toMatch(/meaningful number/i);
    expect(claim).not.toMatch(/\d+ leads/);
  });

  it("returns gentler language for high-scoring audits", () => {
    const audit = { overall_score: 90, opportunity_grade: "A+" as const };
    const claim = softenLeadLossClaim(audit);
    expect(claim).toMatch(/incremental/i);
  });
});

describe("softenSummary", () => {
  it("replaces 'losing exactly N leads/month' with soft language", () => {
    const out = softenSummary("They are losing exactly 85 leads/month right now.");
    expect(out).not.toContain("losing exactly 85");
    expect(out).toMatch(/missing a meaningful number of local leads/i);
  });

  it("replaces guarantees with conditional phrasing", () => {
    const out = softenSummary("We guarantee top ranking in 60 days.");
    expect(out).not.toMatch(/guarantee top ranking/i);
    expect(out).toMatch(/improves the odds/i);
  });

  it("returns empty string when given undefined", () => {
    expect(softenSummary(undefined)).toBe("");
  });
});

describe("buildDefaultSections", () => {
  it("uses audit data when available", () => {
    const audit: AuditJson = {
      overall_score: 55,
      seo_score: 50,
      speed_score: 60,
      mobile_score: 50,
      conversion_score: 55,
      opportunity_grade: "B",
      missing_pages: ["Service area pages"],
      missing_schema: ["LocalBusiness"],
      gbp_issues: [],
      competitor_gaps: ["Faster site"],
      top_3_recommendations: ["Add LocalBusiness schema", "Fix mobile nav", "Improve CWV"],
      estimated_monthly_leads_lost: 42,
      summary: "Solid site, missing exactly 42 leads/month.",
    };
    const sections = buildDefaultSections({
      client_name: "Acme HVAC",
      business_type: "HVAC",
      website_url: "https://acme.com",
      selected_services: [
        { name: "Foundation Website", price: 3500, billing: "one-time" },
      ],
      totals: { total_one_time: 3500, total_monthly: 0 },
      audit,
    });
    expect(sections.executive_summary).not.toContain("losing exactly 42");
    expect(sections.what_we_found).toContain("LocalBusiness");
    expect(sections.our_recommendation).toContain("Foundation Website");
    expect(sections.investment_summary).toContain("$3,500");
  });

  it("falls back to generic content when no audit and no services", () => {
    const sections = buildDefaultSections({
      client_name: "",
      business_type: "",
      website_url: "",
      selected_services: [],
      totals: { total_one_time: 0, total_monthly: 0 },
      audit: null,
    });
    expect(sections.what_we_found).toBeTruthy();
    expect(sections.our_recommendation).toContain("discovery call");
    expect(sections.investment_summary).toContain("discovery call");
  });
});

describe("slugifyClient", () => {
  it("lowercases, hyphenates, and strips special characters", () => {
    expect(slugifyClient("Acme HVAC & Co.")).toBe("acme-hvac-and-co");
  });

  it("returns 'client' fallback when given empty input", () => {
    expect(slugifyClient("")).toBe("client");
    expect(slugifyClient("   ")).toBe("client");
  });
});
