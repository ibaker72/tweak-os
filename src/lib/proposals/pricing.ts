import type { ProposalService } from "./types";

export { calculateTotals } from "./services";

export type PriceMode = "one_time" | "setup_plus_monthly";

export const NJ_SOURCE_LABEL = "NJ Business Records";

/**
 * Starting amounts for the programmatic default bundles below. These are
 * internal starting points for a machine-created draft, not customer
 * prices: whoever opens the proposal edits every amount before it is
 * generated or sent.
 */
const DEFAULT_PRICES = {
  launch_kit: 2500,
  standard_build: 3500,
  premium_build: 6500,
  care_plan: 297,
  seo_maintenance: 400,
} as const;

const CARE_PLAN_NAME = "Monthly Website/SEO Care Plan";
const SEO_MAINTENANCE_NAME = "Monthly SEO Maintenance";

/**
 * Premium package names that justify the higher build tier
 * ($6,500+ one-time). Anything outside this list — and especially the
 * Launch Kit pitch — should default to lower, startup-friendly pricing.
 * These names are legacy: they are matched against what a caller sends,
 * not offered anywhere in the current catalog.
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

/**
 * Default service bundles for proposals created programmatically (a
 * caller that names a package rather than picking scope in the
 * composer). Newly filed NJ businesses with no website get Launch Kit
 * pricing; everyone else gets the standard build tier. Every amount is a
 * starting point the agent edits before the proposal goes out.
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
  // Keep the caller's package label when provided so the proposal header
  // still reads whatever they sent rather than a generic default.
  const launchKitLine: ProposalService = {
    name: packageName || "New Business Launch",
    one_time_price: DEFAULT_PRICES.launch_kit,
  };

  if (priceMode === "setup_plus_monthly") {
    return [
      launchKitLine,
      { name: CARE_PLAN_NAME, monthly_price: DEFAULT_PRICES.care_plan },
    ];
  }

  return [launchKitLine];
}

function buildStandardServices(
  packageName: string,
  priceMode: PriceMode
): ProposalService[] {
  if (priceMode === "setup_plus_monthly") {
    return [
      { name: packageName, one_time_price: DEFAULT_PRICES.premium_build },
      {
        name: SEO_MAINTENANCE_NAME,
        monthly_price: DEFAULT_PRICES.seo_maintenance,
      },
    ];
  }

  return [{ name: packageName, one_time_price: DEFAULT_PRICES.standard_build }];
}
