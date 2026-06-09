import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Lead } from "./types";

const generateCompletion = vi.fn<(opts: { system: string; user: string; maxTokens: number }) => Promise<string>>();

vi.mock("@/lib/ai/anthropic", () => ({
  generateCompletion: (opts: { system: string; user: string; maxTokens: number }) => generateCompletion(opts),
}));

// Import after the mock is set up
const { generateOutreach } = await import("./outreach");

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
    source_filing_date: null,
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

beforeEach(() => {
  generateCompletion.mockReset();
});

describe("generateOutreach — launch kit branch", () => {
  it("uses the Launch Kit prompt when NJ source + no website", async () => {
    generateCompletion.mockResolvedValueOnce(
      JSON.stringify({
        pain_points: ["No website", "No GBP", "No leads"],
        offer_angle: "Get them online fast",
        cold_email: "Hi — I came across your new business...",
        sms: "Hi! Quick note about your new business.",
        call_opener: "Hi, this is Tweak & Build calling.",
        linkedin_dm: "Saw your new filing, want to help.",
        follow_up_email: "Just following up.",
      })
    );

    const result = await generateOutreach(makeLead());

    expect(generateCompletion).toHaveBeenCalledTimes(1);
    const call = generateCompletion.mock.calls[0][0];
    // The launch-kit branch sells the Launch Kit, not the studio's website-audit tiers.
    expect(call.system).toContain("New Business Launch Kit");
    expect(call.system).not.toContain("Rapid Build");
    expect(call.system).not.toContain("Custom Engineering");
    expect(result.pricing_tier).toBe("New Business Launch Kit");
    expect(result.sms).toBe("Hi! Quick note about your new business.");
    expect(result.call_opener).toBe("Hi, this is Tweak & Build calling.");
  });

  it("falls back to launch-kit defaults when the model returns non-JSON", async () => {
    generateCompletion.mockResolvedValueOnce("not valid json here");
    const result = await generateOutreach(makeLead());
    expect(result.pricing_tier).toBe("New Business Launch Kit");
    expect(result.cold_email).toBe("not valid json here");
  });

  it("uses the website-audit prompt when a website is present", async () => {
    generateCompletion.mockResolvedValueOnce(
      JSON.stringify({
        pain_points: ["slow site"],
        offer_angle: "Rapid Build",
        cold_email: "Audit email",
        linkedin_dm: "dm",
        follow_up_email: "follow",
      })
    );

    await generateOutreach(makeLead({ website: "https://example.com" }));

    const call = generateCompletion.mock.calls[0][0];
    // The website branch references the Tweak & Build studio tiers.
    expect(call.system).toContain("Rapid Build");
    expect(call.system).not.toContain("New Business Launch Kit");
  });
});
