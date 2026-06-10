// ============================================
// Proposal Types
// ============================================

export type ProposalStatus = "draft" | "saved" | "sent" | "won" | "lost";

export type Billing = "one-time" | "monthly";

export interface ProposalService {
  name: string;
  price: number;
  billing: Billing;
}

export interface ProposalInput {
  client_name: string;
  business_type: string;
  website_url: string;
  selected_services: ProposalService[];
  notes: string;
  audit_id?: string;
  lead_id?: string;
}

/**
 * The seven editable sections that make up a proposal. Each is plain
 * markdown so the composer can show one textarea per section and the
 * preview can re-render them together as one document.
 */
export interface ProposalSections {
  executive_summary: string;
  what_we_found: string;
  our_recommendation: string;
  investment_summary: string;
  what_happens_next: string;
  about: string;
  custom_notes: string;
}

export const SECTION_ORDER: (keyof ProposalSections)[] = [
  "executive_summary",
  "what_we_found",
  "our_recommendation",
  "investment_summary",
  "what_happens_next",
  "about",
  "custom_notes",
];

export const SECTION_TITLES: Record<keyof ProposalSections, string> = {
  executive_summary: "Executive Summary",
  what_we_found: "What We Found",
  our_recommendation: "Our Recommendation",
  investment_summary: "Investment Summary",
  what_happens_next: "What Happens Next",
  about: "About Tweak & Build",
  custom_notes: "Custom Notes",
};

export interface ProposalTotals {
  total_one_time: number;
  total_monthly: number;
}

export interface Proposal {
  id: string;
  lead_id: string | null;
  audit_id?: string | null;
  client_name: string | null;
  business_type: string | null;
  website_url?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  services_json: ProposalService[] | null;
  proposal_html: string | null;
  proposal_sections?: Partial<ProposalSections> | null;
  proposal_text?: string | null;
  pdf_url?: string | null;
  total_one_time: number;
  total_monthly: number;
  status: ProposalStatus;
  sent_at?: string | null;
  last_edited_at?: string | null;
  created_at: string;
}

export interface ServiceCatalogItem {
  id: string;
  name: string;
  price: number;
  billing: Billing;
  /** Optional secondary recurring price (e.g. Premium Growth has both) */
  secondary?: { price: number; billing: Billing };
  group: ServiceGroup;
  label: string;
}

export type ServiceGroup = "websites" | "marketing" | "addons";

export const SERVICE_GROUPS: { id: ServiceGroup; label: string }[] = [
  { id: "websites", label: "Websites" },
  { id: "marketing", label: "Marketing & Ads" },
  { id: "addons", label: "Add-ons" },
];

export const SERVICE_CATALOG: ServiceCatalogItem[] = [
  // Websites
  {
    id: "new-business-launch-kit",
    name: "New Business Launch Kit",
    price: 2500,
    billing: "one-time",
    group: "websites",
    label: "New Business Launch Kit — $2,500 one-time",
  },
  {
    id: "foundation-website",
    name: "Foundation Website",
    price: 3500,
    billing: "one-time",
    group: "websites",
    label: "Foundation Website — $3,500 one-time",
  },
  {
    id: "growth-website-system",
    name: "Growth Website System",
    price: 6500,
    billing: "one-time",
    group: "websites",
    label: "Growth Website System — $6,500 one-time",
  },
  {
    id: "premium-growth-package",
    name: "Premium Growth Package",
    price: 8500,
    billing: "one-time",
    secondary: { price: 800, billing: "monthly" },
    group: "websites",
    label: "Premium Growth Package — $8,500 + $800/mo",
  },
  {
    id: "dealership-website-system",
    name: "Dealership Website System",
    price: 8500,
    billing: "one-time",
    secondary: { price: 600, billing: "monthly" },
    group: "websites",
    label: "Dealership Website System — $8,500 + $600/mo",
  },
  // Marketing & Ads
  {
    id: "ads-starter",
    name: "Ads Starter",
    price: 1500,
    billing: "monthly",
    group: "marketing",
    label: "Ads Starter — $1,500/mo",
  },
  {
    id: "full-funnel-ads",
    name: "Full-Funnel Ads Management",
    price: 2500,
    billing: "monthly",
    group: "marketing",
    label: "Full-Funnel Ads Management — $2,500/mo",
  },
  {
    id: "growth-partnership",
    name: "Growth Partnership",
    price: 4500,
    billing: "monthly",
    group: "marketing",
    label: "Growth Partnership — $4,500/mo",
  },
  // Add-ons
  {
    id: "ai-local-seo-pages",
    name: "AI Local SEO Pages",
    price: 200,
    billing: "one-time",
    group: "addons",
    label: "AI Local SEO Pages — $200/page",
  },
  {
    id: "monthly-website-seo-care-plan",
    name: "Monthly Website/SEO Care Plan",
    price: 297,
    billing: "monthly",
    group: "addons",
    label: "Monthly Website/SEO Care Plan — $297/mo",
  },
  {
    id: "monthly-seo-maintenance",
    name: "Monthly SEO Maintenance",
    price: 400,
    billing: "monthly",
    group: "addons",
    label: "Monthly SEO Maintenance — $400/mo",
  },
  {
    id: "ga4-conversion-tracking",
    name: "GA4 + Conversion Tracking",
    price: 350,
    billing: "one-time",
    group: "addons",
    label: "GA4 + Conversion Tracking — $350 one-time",
  },
  {
    id: "cro-audit",
    name: "CRO Audit",
    price: 500,
    billing: "one-time",
    group: "addons",
    label: "CRO Audit — $500 one-time",
  },
];

export const BUSINESS_TYPES = [
  "Home Services",
  "Contractor / Trades",
  "Garage Door Contractor",
  "HVAC",
  "Plumbing",
  "Roofing",
  "Auto Dealer",
  "Restaurant",
  "Professional Services",
  "Real Estate",
  "Retail",
  "Other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
