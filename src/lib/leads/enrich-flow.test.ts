import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Lead } from "./types";

const enrichWebsite = vi.fn();
const searchGooglePlaces = vi.fn();
const getPlaceDetails = vi.fn();
const generateCompletion = vi.fn();

vi.mock("./enrichment", () => ({
  enrichWebsite: (...args: unknown[]) => enrichWebsite(...args),
}));
vi.mock("./google-places", () => ({
  searchGooglePlaces: (...args: unknown[]) => searchGooglePlaces(...args),
  getPlaceDetails: (...args: unknown[]) => getPlaceDetails(...args),
}));
vi.mock("@/lib/ai/anthropic", () => ({
  generateCompletion: (opts: unknown) => generateCompletion(opts),
}));

const { enrichOneLead } = await import("./enrich-flow");

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    business_name: "ROCKSTAR BEAUTY LLC",
    website: null,
    email: null,
    phone: null,
    address: null,
    city: "Newark",
    state: "NJ",
    zip: null,
    country: "US",
    industry: null,
    niche: null,
    category: null,
    google_place_id: null,
    google_rating: null,
    google_review_count: null,
    tech_stack: [],
    has_ssl: null,
    is_mobile_responsive: null,
    has_blog: null,
    has_ecommerce: null,
    page_load_time_ms: null,
    performance_grade: null,
    social_links: {},
    score: 0,
    score_breakdown: {},
    lifecycle_status: "new",
    enrichment_status: "pending",
    outreach: null,
    notes: null,
    manual_notes: null,
    source: "NJ Business Records",
    enrichment_error: null,
    contact_status: null,
    online_presence: null,
    enrichment_summary: null,
    external_id: null,
    entity_type: null,
    entity_status: null,
    registered_agent: null,
    source_filing_date: "2026-04-15",
    import_notes: null,
    contacted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    page_title: null,
    email_1: null,
    email_2: null,
    phone_1: null,
    phone_2: null,
    contact_page: null,
    facebook: null,
    instagram: null,
    linkedin: null,
    twitter: null,
    reasons: [],
    pain_point_1: null,
    pain_point_2: null,
    offer_angle: null,
    suggested_first_line: null,
    ...overrides,
  };
}

function makeSupabaseStub() {
  // Captures every .update() so tests can assert what was written.
  const updates: Record<string, unknown>[] = [];
  const builder = () => {
    const chain = {
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push(payload);
        return chain;
      }),
      eq: vi.fn(() => Promise.resolve({ error: null })),
    };
    return chain;
  };
  const supabase = { from: vi.fn(() => builder()) };
  return { supabase, updates };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  enrichWebsite.mockReset();
  searchGooglePlaces.mockReset();
  getPlaceDetails.mockReset();
  generateCompletion.mockReset();
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("enrichOneLead", () => {
  it("marks complete with not_found when Places returns zero results (NOT failed)", async () => {
    searchGooglePlaces.mockResolvedValueOnce([]);
    const { supabase, updates } = makeSupabaseStub();

    const outcome = await enrichOneLead(supabase as never, makeLead());

    expect(outcome.status).toBe("complete");
    expect(outcome.contact_status).toBe("not_found");
    expect(outcome.online_presence).toBe("none_found");
    // The persisted enrichment status must be "complete", not "failed".
    expect(updates.some((u) => u.enrichment_status === "complete")).toBe(true);
    expect(updates.some((u) => u.enrichment_status === "failed")).toBe(false);
  });

  it("fails with the real error message when Places API throws", async () => {
    searchGooglePlaces.mockRejectedValueOnce(new Error("Google Places API error: 429"));
    const { supabase, updates } = makeSupabaseStub();

    const outcome = await enrichOneLead(supabase as never, makeLead());

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("Google Places API error: 429");
    expect(updates.some((u) => u.enrichment_status === "failed" && u.enrichment_error === "Google Places API error: 429")).toBe(true);
  });

  it("fails with a clear message when GOOGLE_PLACES_API_KEY is missing", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const { supabase, updates } = makeSupabaseStub();

    const outcome = await enrichOneLead(supabase as never, makeLead());

    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("Missing GOOGLE_PLACES_API_KEY");
    expect(updates.some((u) => u.enrichment_error === "Missing GOOGLE_PLACES_API_KEY")).toBe(true);
  });

  it("runs the website path when a website exists (no Places call)", async () => {
    enrichWebsite.mockResolvedValueOnce({
      page_title: "Acme",
      emails: ["info@acme.com"],
      phones: [],
      contact_page: null,
      facebook: null,
      instagram: null,
      linkedin: null,
      twitter: null,
      tech_stack: ["Wix"],
      has_ssl: true,
      is_mobile_responsive: true,
      has_blog: false,
      has_ecommerce: false,
      page_load_time_ms: 1500,
      performance_grade: "A",
      last_modified: null,
    });
    const { supabase } = makeSupabaseStub();

    const outcome = await enrichOneLead(
      supabase as never,
      makeLead({ source: null, website: "https://acme.com", business_name: "Acme Co" })
    );

    expect(searchGooglePlaces).not.toHaveBeenCalled();
    expect(enrichWebsite).toHaveBeenCalledWith("https://acme.com");
    expect(outcome.status).toBe("complete");
    expect(outcome.contact_status).toBe("found");
  });

  it("hydrates a website from Places and runs the website path", async () => {
    searchGooglePlaces.mockResolvedValueOnce([
      {
        business_name: "ROCKSTAR BEAUTY LLC",
        google_place_id: "place-1",
        address: "123 Main St, Newark, NJ 07102",
        google_rating: 4.5,
        google_review_count: 30,
      },
    ]);
    getPlaceDetails.mockResolvedValueOnce({
      phone: "+1 555-1212",
      website: "https://rockstarbeauty.com",
      hours: [],
    });
    enrichWebsite.mockResolvedValueOnce({
      page_title: "Rockstar Beauty",
      emails: [],
      phones: [],
      contact_page: null,
      facebook: null,
      instagram: null,
      linkedin: null,
      twitter: null,
      tech_stack: ["Wix"],
      has_ssl: true,
      is_mobile_responsive: false,
      has_blog: false,
      has_ecommerce: false,
      page_load_time_ms: 4000,
      performance_grade: "C",
      last_modified: null,
    });
    const { supabase } = makeSupabaseStub();

    const outcome = await enrichOneLead(supabase as never, makeLead());

    expect(enrichWebsite).toHaveBeenCalledWith("https://rockstarbeauty.com");
    expect(outcome.status).toBe("complete");
  });
});
