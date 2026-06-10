import { SERVICE_CATALOG, type ProposalService } from "./types";

export type PriceMode = "one_time" | "setup_plus_monthly";

export const NJ_SOURCE_LABEL = "NJ Business Records";

/**
 * Premium packages that justify the Growth Website System tier pricing
 * ($6,500+ one-time). Anything outside this list — and especially the
 * Launch Kit pitch — should default to lower, startup-friendly pricing.
 */
const PREMIUM_PACKAGE_KEYWORDS = [
  "full growth system",
  "custom website + seo",
  "custom website and seo",
  "ads funnel buildout",
  "premium growth",
  "dealership",
];

const LAUNCH_KIT_PACKAGE_KEYWORDS = [
  "launch kit",
  "new business",
];

export interface LaunchKitLeadContext {
  source: string | null;
  website: string | null;
  source_filing_date: string | null;
  created_at: string | null;
}

/**
 * A "Launch Kit lead" is a newly filed small business with no website
 * yet — typically a fresh NJ Business Records import. These leads
 * cannot support $6,500 packages and should get the Launch Kit pricing
 * instead.
 */
export function isLaunchKitLead(
  lead: LaunchKitLeadContext,
  now: Date = new Date()
): boolean {
  if (lead.source !== NJ_SOURCE_LABEL) return false;
  if (lead.website) return false;
  if (lead.source_filing_date) return true;
  if (!lead.created_at) return false;
  const created = new Date(lead.created_at).getTime();
  if (Number.isNaN(created)) return false;
  const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
  return now.getTime() - created < sixtyDaysMs;
}

function packageMatches(packageName: string, keywords: string[]): boolean {
  const p = packageName.toLowerCase();
  return keywords.some((k) => p.includes(k));
}

export function isPremiumPackage(packageName: string): boolean {
  return packageMatches(packageName, PREMIUM_PACKAGE_KEYWORDS);
}

export function isLaunchKitPackage(packageName: string): boolean {
  return packageMatches(packageName, LAUNCH_KIT_PACKAGE_KEYWORDS);
}

function findService(id: string) {
  return SERVICE_CATALOG.find((s) => s.id === id);
}

/**
 * Default service bundles for proposals created via the API. Newly
 * filed NJ businesses with no website get the Launch Kit pricing —
 * established businesses (or anyone who explicitly asks for a premium
 * package) keep the Growth Website System / Foundation Website tiers.
 */
export function buildDefaultServices(args: {
  packageName: string;
  priceMode: PriceMode;
  lead: LaunchKitLeadContext;
  now?: Date;
}): ProposalService[] {
  const { packageName, priceMode, lead, now } = args;

  const premium = isPremiumPackage(packageName);
  const launchKitFit =
    !premium && (isLaunchKitLead(lead, now) || isLaunchKitPackage(packageName));

  if (launchKitFit) {
    return buildLaunchKitServices(packageName, priceMode);
  }
  return buildStandardServices(packageName, priceMode);
}

function buildLaunchKitServices(
  packageName: string,
  priceMode: PriceMode
): ProposalService[] {
  const launchKit = findService("new-business-launch-kit");
  // Keep the caller's package label when provided so the proposal
  // header still reads "New Business Launch Kit" (or whatever they
  // sent) rather than the catalog default.
  const launchKitLine: ProposalService = {
    name: packageName || launchKit?.name || "New Business Launch Kit",
    price: launchKit?.price ?? 2500,
    billing: "one-time",
  };

  if (priceMode === "setup_plus_monthly") {
    const monthly = findService("monthly-website-seo-care-plan");
    return [
      launchKitLine,
      {
        name: monthly?.name ?? "Monthly Website/SEO Care Plan",
        price: monthly?.price ?? 297,
        billing: "monthly",
      },
    ];
  }

  return [launchKitLine];
}

function buildStandardServices(
  packageName: string,
  priceMode: PriceMode
): ProposalService[] {
  const foundation = findService("foundation-website");
  const growth = findService("growth-website-system");
  const seo = findService("monthly-seo-maintenance");

  if (priceMode === "setup_plus_monthly") {
    return [
      {
        name: packageName,
        price: growth?.price ?? 6500,
        billing: "one-time",
      },
      {
        name: seo?.name ?? "Monthly Care + SEO",
        price: seo?.price ?? 400,
        billing: "monthly",
      },
    ];
  }

  return [
    {
      name: packageName,
      price: foundation?.price ?? 3500,
      billing: "one-time",
    },
  ];
}

export function calculateTotals(services: ProposalService[]): {
  total_one_time: number;
  total_monthly: number;
} {
  let total_one_time = 0;
  let total_monthly = 0;
  for (const s of services) {
    if (s.billing === "one-time") total_one_time += s.price;
    else if (s.billing === "monthly") total_monthly += s.price;
  }
  return { total_one_time, total_monthly };
}
