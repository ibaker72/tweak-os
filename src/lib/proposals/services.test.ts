import { describe, expect, it } from "vitest";
import {
  buildInvestmentSummary,
  calculateTotals,
  catalogSuggestionLabel,
  formatServicePricing,
  normalizeService,
  normalizeServices,
  serviceFromCatalogItem,
} from "./services";
import {
  SERVICE_CATALOG,
  SERVICE_GROUPS,
  type ProposalService,
} from "./types";

// The fixed packages the catalog used to sell. They must never come back
// as a selectable template, but a proposal that already names one has to
// keep working — see the legacy compatibility tests below.
const LEGACY_PACKAGE_NAMES = [
  "Foundation Website",
  "Growth Website System",
  "Premium Growth Package",
  "Dealership Website System",
  "Ads Starter",
  "Full-Funnel Ads Management",
  "Growth Partnership",
];

describe("service catalog", () => {
  it("no longer offers any of the legacy fixed packages", () => {
    const names = SERVICE_CATALOG.map((item) => item.name);
    for (const legacy of LEGACY_PACKAGE_NAMES) {
      expect(names).not.toContain(legacy);
    }
  });

  it("exposes the five current groups", () => {
    expect(SERVICE_GROUPS.map((g) => g.id)).toEqual([
      "websites",
      "marketing",
      "media",
      "custom",
      "addons",
    ]);
  });

  it("offers the current services in every group", () => {
    const byGroup = (group: string) =>
      SERVICE_CATALOG.filter((item) => item.group === group).map((i) => i.name);

    expect(byGroup("websites")).toEqual([
      "New Business Launch",
      "Custom Business Website",
      "Local Growth System",
    ]);
    expect(byGroup("marketing")).toEqual([
      "Paid Ads Management",
      "Local Lead Generation",
      "Full Growth / Acquisition Management",
    ]);
    expect(byGroup("media")).toEqual([
      "Drone Photography / Video",
      "Business Photo / Video Content",
      "Custom Media Package",
    ]);
    expect(byGroup("custom")).toEqual([
      "Web Application / Client Portal",
      "Automation & AI System",
      "E-Commerce / Storefront",
      "Landing Page / Funnel",
      "Custom Development",
    ]);
    expect(byGroup("addons")).toEqual([
      "Local SEO / City Pages",
      "Google Business Profile Optimization",
      "Analytics & Conversion Tracking",
      "Review / Reputation System",
      "CRM / Lead Follow-Up Automation",
      "Maintenance / Ongoing Support",
    ]);
  });

  it("gives every catalog item a unique id and a group that exists", () => {
    const ids = SERVICE_CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(SERVICE_GROUPS.map((g) => g.id));
    for (const item of SERVICE_CATALOG) {
      expect(groups.has(item.group)).toBe(true);
    }
  });

  it("keeps the website starting points as suggestions, not locked prices", () => {
    const suggestions = Object.fromEntries(
      SERVICE_CATALOG.map((item) => [item.id, item.suggested_one_time])
    );
    expect(suggestions["new-business-launch"]).toBe(2500);
    expect(suggestions["custom-business-website"]).toBe(3500);
    expect(suggestions["local-growth-system"]).toBe(6500);
  });

  it("leaves services with no defensible starting price unpriced", () => {
    const unpriced = SERVICE_CATALOG.filter(
      (item) =>
        item.suggested_one_time === undefined &&
        item.suggested_monthly === undefined
    ).map((item) => item.id);
    expect(unpriced).toContain("drone-photo-video");
    expect(unpriced).toContain("web-application-portal");
    expect(unpriced).toContain("local-seo-city-pages");
  });

  it("seeds a selected line from a catalog template", () => {
    const item = SERVICE_CATALOG.find((i) => i.id === "custom-business-website")!;
    expect(serviceFromCatalogItem(item)).toEqual({
      id: "custom-business-website",
      name: "Custom Business Website",
      one_time_price: 3500,
    });
  });

  it("seeds an unpriced line with no amounts at all", () => {
    const item = SERVICE_CATALOG.find((i) => i.id === "drone-photo-video")!;
    expect(serviceFromCatalogItem(item)).toEqual({
      id: "drone-photo-video",
      name: "Drone Photography / Video",
    });
    expect(catalogSuggestionLabel(item)).toBe("Custom scoped");
  });
});

describe("calculateTotals", () => {
  it("totals a one-time-only service", () => {
    const totals = calculateTotals([
      { name: "Custom Business Website", one_time_price: 4800 },
    ]);
    expect(totals).toEqual({ total_one_time: 4800, total_monthly: 0 });
  });

  it("totals a monthly-only service", () => {
    const totals = calculateTotals([
      { name: "Local SEO / City Pages", monthly_price: 750 },
    ]);
    expect(totals).toEqual({ total_one_time: 0, total_monthly: 750 });
  });

  it("counts a service with both amounts in both buckets", () => {
    const totals = calculateTotals([
      { name: "Local Growth System", one_time_price: 6500, monthly_price: 800 },
    ]);
    expect(totals).toEqual({ total_one_time: 6500, total_monthly: 800 });
  });

  it("aggregates a mixed set of services", () => {
    const totals = calculateTotals([
      { name: "Local Growth System", one_time_price: 6500, monthly_price: 800 },
      { name: "Analytics & Conversion Tracking", one_time_price: 350 },
      { name: "Paid Ads Management", monthly_price: 1500 },
      { name: "Drone Photography / Video" },
    ]);
    expect(totals).toEqual({ total_one_time: 6850, total_monthly: 2300 });
  });

  it("never folds monthly amounts into the one-time total", () => {
    const totals = calculateTotals([
      { name: "Maintenance / Ongoing Support", monthly_price: 297 },
    ]);
    expect(totals.total_one_time).toBe(0);
  });

  it("tolerates a null or malformed payload", () => {
    expect(calculateTotals(null)).toEqual({ total_one_time: 0, total_monthly: 0 });
    expect(calculateTotals([null, 7, {}, { name: "" }])).toEqual({
      total_one_time: 0,
      total_monthly: 0,
    });
  });
});

describe("edited pricing", () => {
  it("uses the agent's amounts, not the catalog suggestion", () => {
    const item = SERVICE_CATALOG.find((i) => i.id === "custom-business-website")!;
    const seeded = serviceFromCatalogItem(item);
    // What the composer does when the agent types a different number.
    const edited: ProposalService = {
      ...seeded,
      one_time_price: 4800,
      monthly_price: 750,
    };

    const roundTripped = normalizeServices(JSON.parse(JSON.stringify([edited])));
    expect(roundTripped[0]).toEqual({
      id: "custom-business-website",
      name: "Custom Business Website",
      one_time_price: 4800,
      monthly_price: 750,
    });
    expect(calculateTotals(roundTripped)).toEqual({
      total_one_time: 4800,
      total_monthly: 750,
    });
    expect(buildInvestmentSummary(roundTripped)).toContain("$4,800");
    expect(buildInvestmentSummary(roundTripped)).not.toContain("$3,500");
  });

  it("keeps a line the agent cleared to unpriced", () => {
    const svc = normalizeService({
      id: "local-lead-generation",
      name: "Local Lead Generation",
    });
    expect(svc?.one_time_price).toBeUndefined();
    expect(svc?.monthly_price).toBeUndefined();
    expect(formatServicePricing(svc!)).toBe("Price to be scoped");
  });
});

describe("scope notes", () => {
  it("survives a save/load round trip", () => {
    const scope =
      "Up to 12 core pages, lead forms, service-area architecture, analytics setup, mobile optimization.";
    const stored = JSON.parse(
      JSON.stringify([
        {
          id: "custom-business-website",
          name: "Custom Business Website",
          description: scope,
          one_time_price: 4800,
        },
      ])
    );
    expect(normalizeServices(stored)[0].description).toBe(scope);
  });

  it("is optional", () => {
    const svc = normalizeService({
      name: "Custom Development",
      one_time_price: 9000,
    });
    expect(svc).toEqual({ name: "Custom Development", one_time_price: 9000 });
    expect("description" in svc!).toBe(false);
  });

  it("drops a blank note rather than storing whitespace", () => {
    const svc = normalizeService({
      name: "Custom Development",
      description: "   ",
      one_time_price: 9000,
    });
    expect(svc?.description).toBeUndefined();
  });
});

describe("legacy services_json compatibility", () => {
  it("maps a legacy one-time line onto one_time_price", () => {
    expect(
      normalizeService({ name: "Foundation Website", price: 3500, billing: "one-time" })
    ).toEqual({ name: "Foundation Website", one_time_price: 3500 });
  });

  it("maps a legacy monthly line onto monthly_price", () => {
    expect(
      normalizeService({ name: "Ads Starter", price: 1500, billing: "monthly" })
    ).toEqual({ name: "Ads Starter", monthly_price: 1500 });
  });

  it("keeps both amounts when a legacy line carried a secondary recurring price", () => {
    expect(
      normalizeService({
        name: "Premium Growth Package",
        price: 8500,
        billing: "one-time",
        secondary: { price: 800, billing: "monthly" },
      })
    ).toEqual({
      name: "Premium Growth Package",
      one_time_price: 8500,
      monthly_price: 800,
    });
  });

  it("treats a legacy line with no billing as one-time", () => {
    expect(normalizeService({ name: "CRO Audit", price: 500 })).toEqual({
      name: "CRO Audit",
      one_time_price: 500,
    });
  });

  it("totals a whole legacy proposal payload correctly", () => {
    const legacy = [
      { name: "Growth Website System", price: 6500, billing: "one-time" },
      { name: "Monthly SEO Maintenance", price: 400, billing: "monthly" },
      { name: "AI Local SEO Pages", price: 200, billing: "one-time" },
    ];
    expect(calculateTotals(legacy)).toEqual({
      total_one_time: 6700,
      total_monthly: 400,
    });
  });

  it("handles the legacy two-row '(recurring)' convention", () => {
    const legacy = [
      { name: "Dealership Website System", price: 8500, billing: "one-time" },
      {
        name: "Dealership Website System (recurring)",
        price: 600,
        billing: "monthly",
      },
    ];
    expect(calculateTotals(legacy)).toEqual({
      total_one_time: 8500,
      total_monthly: 600,
    });
  });

  it("renders a legacy proposal's investment summary with its original amounts", () => {
    const summary = buildInvestmentSummary([
      { name: "Premium Growth Package", price: 8500, billing: "one-time" },
      { name: "Growth Partnership", price: 4500, billing: "monthly" },
    ]);
    expect(summary).toContain("| Premium Growth Package | $8,500 | — |");
    expect(summary).toContain("| Growth Partnership | — | $4,500/month |");
    expect(summary).toContain("**Total One-Time Investment:** $8,500");
    expect(summary).toContain("**Monthly Ongoing Investment:** $4,500/month");
  });

  it("does not double-count a line that carries both shapes", () => {
    expect(
      calculateTotals([
        {
          name: "Custom Business Website",
          one_time_price: 4800,
          price: 4800,
          billing: "one-time",
        },
      ])
    ).toEqual({ total_one_time: 4800, total_monthly: 0 });
  });

  it("reads amounts that came back from jsonb as strings", () => {
    expect(
      normalizeService({ name: "Local Growth System", one_time_price: "6500" })
    ).toEqual({ name: "Local Growth System", one_time_price: 6500 });
  });
});

describe("buildInvestmentSummary", () => {
  it("keeps one-time and monthly in separate columns and separate totals", () => {
    const summary = buildInvestmentSummary([
      { name: "Custom Business Website", one_time_price: 4800 },
      { name: "Local SEO / City Pages", monthly_price: 750 },
    ]);
    expect(summary).toContain("| Service | One-Time | Monthly |");
    expect(summary).toContain("| Custom Business Website | $4,800 | — |");
    expect(summary).toContain("| Local SEO / City Pages | — | $750/month |");
    expect(summary).toContain("**Total One-Time Investment:** $4,800");
    expect(summary).toContain("**Monthly Ongoing Investment:** $750/month");
    // $5,550 would be the misleading combined figure.
    expect(summary).not.toContain("$5,550");
  });

  it("shows a service with both amounts in both columns", () => {
    const summary = buildInvestmentSummary([
      { name: "Local Growth System", one_time_price: 6500, monthly_price: 800 },
    ]);
    expect(summary).toContain("| Local Growth System | $6,500 | $800/month |");
    expect(summary).toContain("**Total One-Time Investment:** $6,500");
    expect(summary).toContain("**Monthly Ongoing Investment:** $800/month");
  });

  it("omits the monthly total when nothing recurs", () => {
    const summary = buildInvestmentSummary([
      { name: "Custom Business Website", one_time_price: 4800 },
    ]);
    expect(summary).not.toContain("Monthly Ongoing Investment");
  });

  it("marks an unpriced line rather than inventing a number", () => {
    const summary = buildInvestmentSummary([
      { name: "Drone Photography / Video" },
    ]);
    expect(summary).toContain("| Drone Photography / Video | — | — |");
    expect(summary).toContain("**Total One-Time Investment:** $0");
  });

  it("falls back to discovery-call wording with no scope selected", () => {
    expect(buildInvestmentSummary([])).toContain("discovery call");
  });
});

describe("formatServicePricing", () => {
  it("shows both amounts when a service has both", () => {
    expect(
      formatServicePricing({
        name: "Local Growth System",
        one_time_price: 6500,
        monthly_price: 800,
      })
    ).toBe("$6,500 one-time + $800/mo");
  });
});
