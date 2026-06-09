import { describe, it, expect } from "vitest";
import { scoreLead, scoreNjStartupLead } from "./scoring";
import type { EnrichmentResult } from "./types";

function emptyEnrichment(): EnrichmentResult {
  return {
    page_title: null,
    emails: [],
    phones: [],
    contact_page: null,
    facebook: null,
    instagram: null,
    linkedin: null,
    twitter: null,
    tech_stack: [],
    has_ssl: false,
    is_mobile_responsive: false,
    has_blog: false,
    has_ecommerce: false,
    page_load_time_ms: null,
    performance_grade: null,
    last_modified: null,
  };
}

describe("scoreNjStartupLead", () => {
  it("scores ROCKSTAR BEAUTY LLC (NJ startup, no site) above 40", () => {
    const result = scoreNjStartupLead({
      business_name: "ROCKSTAR BEAUTY LLC",
      source: "NJ Business Records",
      website: null,
      city: "Newark",
      state: "NJ",
      address: null,
      source_filing_date: "2026-04-15",
    });
    // +25 NJ + +20 filing + +20 no website + +15 beauty + +10 city = 90
    expect(result.score).toBeGreaterThan(40);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("penalizes holding-co names", () => {
    const result = scoreNjStartupLead({
      business_name: "ACME HOLDINGS LLC",
      source: "NJ Business Records",
      website: null,
      city: "Trenton",
      state: "NJ",
      address: null,
      source_filing_date: "2026-01-01",
    });
    // +25 NJ + +20 filing + +20 no website + +10 city - 25 holding = 50
    // industry guess won't trigger for "holdings"
    expect(result.score).toBeLessThan(60);
    expect(result.breakdown["Holding-co keywords"]).toBe(-25);
  });

  it("clamps to 0..100", () => {
    const result = scoreNjStartupLead({
      business_name: "ACME HOLDINGS LLC INVESTMENT TRUST CAPITAL",
      source: null,
      website: "https://acme.com",
      city: null,
      state: null,
      address: null,
      source_filing_date: null,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("scoreLead", () => {
  it("routes NJ-no-website leads through the startup scorer", () => {
    const result = scoreLead(emptyEnrichment(), {
      business_name: "ROCKSTAR BEAUTY LLC",
      source: "NJ Business Records",
      website: null,
      niche: null,
      city: "Newark",
      state: "NJ",
      source_filing_date: "2026-04-15",
    });
    expect(result.score).toBeGreaterThan(40);
    // The startup branch tags the NJ Business Records source explicitly.
    expect(result.breakdown["NJ Business Records source"]).toBe(25);
  });

  it("returns 0 for non-NJ leads with no website (existing contract preserved)", () => {
    const result = scoreLead(emptyEnrichment(), {
      website: null,
      niche: null,
      city: null,
      state: null,
    });
    expect(result.score).toBe(0);
  });

  it("scores a website lead on a rebuild platform (unchanged behavior)", () => {
    const enrichment = emptyEnrichment();
    enrichment.tech_stack = ["Wix"];
    enrichment.has_ssl = true;
    enrichment.is_mobile_responsive = true;
    const result = scoreLead(enrichment, {
      website: "https://example.com",
      niche: null,
      city: null,
      state: "NJ",
    });
    // +20 rebuild platform + +10 local = 30 (no SSL or mobile penalties)
    expect(result.breakdown["Rebuild platform detected"]).toBe(20);
    expect(result.score).toBeGreaterThan(20);
  });
});
