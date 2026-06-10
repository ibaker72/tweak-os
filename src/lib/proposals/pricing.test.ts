import { describe, expect, it } from "vitest";
import {
  buildDefaultServices,
  calculateTotals,
  isLaunchKitLead,
  isLaunchKitPackage,
  isPremiumPackage,
} from "./pricing";

const NJ_LEAD = {
  source: "NJ Business Records",
  website: null,
  source_filing_date: "2026-05-01",
  created_at: "2026-05-01T00:00:00Z",
};

const ESTABLISHED_LEAD = {
  source: "google_places",
  website: "https://acme-hvac.com",
  source_filing_date: null,
  created_at: "2024-01-01T00:00:00Z",
};

describe("isLaunchKitLead", () => {
  it("matches NJ Business Records leads with no website and a filing date", () => {
    expect(isLaunchKitLead(NJ_LEAD)).toBe(true);
  });

  it("matches recently created NJ leads even without a filing date", () => {
    const recent = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isLaunchKitLead({
        source: "NJ Business Records",
        website: null,
        source_filing_date: null,
        created_at: recent,
      })
    ).toBe(true);
  });

  it("does not match if the lead has a website", () => {
    expect(
      isLaunchKitLead({
        ...NJ_LEAD,
        website: "https://acme-llc.com",
      })
    ).toBe(false);
  });

  it("does not match leads from other sources", () => {
    expect(isLaunchKitLead(ESTABLISHED_LEAD)).toBe(false);
  });

  it("does not match NJ leads older than 60 days without a filing date", () => {
    expect(
      isLaunchKitLead({
        source: "NJ Business Records",
        website: null,
        source_filing_date: null,
        created_at: "2020-01-01T00:00:00Z",
      })
    ).toBe(false);
  });
});

describe("isPremiumPackage", () => {
  it("recognizes the premium package names from the task spec", () => {
    expect(isPremiumPackage("Full Growth System")).toBe(true);
    expect(isPremiumPackage("Custom Website + SEO")).toBe(true);
    expect(isPremiumPackage("Ads Funnel Buildout")).toBe(true);
  });

  it("does not flag the Launch Kit as premium", () => {
    expect(isPremiumPackage("New Business Launch Kit")).toBe(false);
  });
});

describe("isLaunchKitPackage", () => {
  it("matches Launch Kit and New Business package names", () => {
    expect(isLaunchKitPackage("New Business Launch Kit")).toBe(true);
    expect(isLaunchKitPackage("Launch Kit")).toBe(true);
  });

  it("does not match other packages", () => {
    expect(isLaunchKitPackage("Full Growth System")).toBe(false);
  });
});

describe("buildDefaultServices — Launch Kit lead", () => {
  it("returns $2,500 launch kit + $297/mo care plan for setup_plus_monthly", () => {
    const services = buildDefaultServices({
      packageName: "New Business Launch Kit",
      priceMode: "setup_plus_monthly",
      lead: NJ_LEAD,
    });
    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({
      name: "New Business Launch Kit",
      price: 2500,
      billing: "one-time",
    });
    expect(services[1]).toMatchObject({
      name: "Monthly Website/SEO Care Plan",
      price: 297,
      billing: "monthly",
    });
    const totals = calculateTotals(services);
    expect(totals.total_one_time).toBe(2500);
    expect(totals.total_monthly).toBe(297);
  });

  it("returns a single $2,500 one-time line for one_time", () => {
    const services = buildDefaultServices({
      packageName: "New Business Launch Kit",
      priceMode: "one_time",
      lead: NJ_LEAD,
    });
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      name: "New Business Launch Kit",
      price: 2500,
      billing: "one-time",
    });
    const totals = calculateTotals(services);
    expect(totals.total_one_time).toBe(2500);
    expect(totals.total_monthly).toBe(0);
  });

  it("never defaults a Launch Kit lead to $6,500", () => {
    const totals = calculateTotals(
      buildDefaultServices({
        packageName: "New Business Launch Kit",
        priceMode: "setup_plus_monthly",
        lead: NJ_LEAD,
      })
    );
    expect(totals.total_one_time).toBeLessThanOrEqual(2500);
    expect(totals.total_monthly).toBeLessThanOrEqual(297);
  });

  it("uses Launch Kit pricing even when the package name is generic, if the lead fits", () => {
    const services = buildDefaultServices({
      packageName: "Website Package",
      priceMode: "one_time",
      lead: NJ_LEAD,
    });
    expect(services[0].price).toBe(2500);
  });

  it("does not produce a standalone $500 setup line in any mode", () => {
    const setupPlusMonthly = buildDefaultServices({
      packageName: "New Business Launch Kit",
      priceMode: "setup_plus_monthly",
      lead: NJ_LEAD,
    });
    const oneTime = buildDefaultServices({
      packageName: "New Business Launch Kit",
      priceMode: "one_time",
      lead: NJ_LEAD,
    });
    for (const svc of [...setupPlusMonthly, ...oneTime]) {
      expect(svc.name).not.toMatch(/setup/i);
      expect(svc.price).not.toBe(500);
    }
  });
});

describe("buildDefaultServices — premium package overrides", () => {
  it("Full Growth System keeps the $6,500 + $400/mo tier for a Launch-Kit-fit lead", () => {
    const services = buildDefaultServices({
      packageName: "Full Growth System",
      priceMode: "setup_plus_monthly",
      lead: NJ_LEAD,
    });
    const totals = calculateTotals(services);
    expect(totals.total_one_time).toBe(6500);
    expect(totals.total_monthly).toBe(400);
  });

  it("Custom Website + SEO keeps the foundation tier for one_time", () => {
    const services = buildDefaultServices({
      packageName: "Custom Website + SEO",
      priceMode: "one_time",
      lead: NJ_LEAD,
    });
    expect(services[0].price).toBe(3500);
  });

  it("Ads Funnel Buildout uses the standard tier", () => {
    const services = buildDefaultServices({
      packageName: "Ads Funnel Buildout",
      priceMode: "setup_plus_monthly",
      lead: NJ_LEAD,
    });
    const totals = calculateTotals(services);
    expect(totals.total_one_time).toBe(6500);
  });
});

describe("buildDefaultServices — established lead", () => {
  it("uses Launch Kit pricing for an established lead when the package name is Launch Kit", () => {
    const services = buildDefaultServices({
      packageName: "New Business Launch Kit",
      priceMode: "setup_plus_monthly",
      lead: ESTABLISHED_LEAD,
    });
    // Launch Kit package name still triggers Launch Kit pricing — owner
    // explicitly chose the Launch Kit offering for this lead.
    expect(services).toHaveLength(2);
    expect(services[0]).toMatchObject({
      name: "New Business Launch Kit",
      price: 2500,
      billing: "one-time",
    });
    expect(services[1]).toMatchObject({
      name: "Monthly Website/SEO Care Plan",
      price: 297,
      billing: "monthly",
    });
  });

  it("uses standard Foundation pricing for an established lead with a non-Launch-Kit package", () => {
    const services = buildDefaultServices({
      packageName: "Website Build",
      priceMode: "one_time",
      lead: ESTABLISHED_LEAD,
    });
    expect(services[0].price).toBe(3500);
  });
});

describe("calculateTotals", () => {
  it("sums one-time and monthly buckets independently", () => {
    const totals = calculateTotals([
      { name: "Setup", price: 500, billing: "one-time" },
      { name: "Care plan", price: 297, billing: "monthly" },
      { name: "Add-on", price: 200, billing: "one-time" },
    ]);
    expect(totals.total_one_time).toBe(700);
    expect(totals.total_monthly).toBe(297);
  });
});
