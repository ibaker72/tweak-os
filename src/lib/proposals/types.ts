// ============================================
// Proposal Types
// ============================================

export type ProposalStatus =
  | "draft"
  | "saved"
  | "sent"
  | "won"
  | "lost"
  | "active"
  | "obsolete"
  | "archived";

/**
 * Billing mode used by the pre-2026 proposal catalog, where every line
 * item carried exactly one price and one billing mode. Retained because
 * historical `services_json` rows still use it — see
 * `normalizeService` in ./services.
 */
export type Billing = "one-time" | "monthly";

/**
 * A single line of scope on a proposal.
 *
 * A line may carry a one-time amount, a monthly amount, both, or neither
 * (an agent can add the scope first and price it later). Amounts are
 * whole-dollar numbers — the same convention the `proposals` table has
 * always used for `services_json`, `total_one_time` and `total_monthly`.
 */
export interface ProposalService {
  /** Catalog id when the line started from a catalog template. */
  id?: string;
  name: string;
  /** Optional short scope note shown to the client and fed to the generator. */
  description?: string;
  one_time_price?: number;
  monthly_price?: number;
}

/**
 * The shape written by the legacy fixed-package catalog. Old proposal
 * rows still hold these, so everything that reads `services_json` goes
 * through `normalizeService`/`normalizeServices` first.
 */
export interface LegacyProposalService {
  name: string;
  price?: number;
  billing?: Billing;
  description?: string;
  /** Some legacy items carried a second recurring amount alongside the first. */
  secondary?: { price: number; billing: Billing };
}

/** Anything that may legitimately appear inside a stored `services_json`. */
export type StoredProposalService = ProposalService | LegacyProposalService;

export interface ProposalInput {
  client_name: string;
  business_type: string;
  website_url: string;
  selected_services: ProposalService[];
  notes: string;
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
  /** May hold either the current or the legacy line shape — normalize on read. */
  services_json: StoredProposalService[] | null;
  proposal_html: string | null;
  proposal_sections?: Partial<ProposalSections> | null;
  proposal_text?: string | null;
  pdf_url?: string | null;
  total_one_time: number;
  total_monthly: number;
  status: ProposalStatus;
  sent_at?: string | null;
  last_edited_at?: string | null;
  archived_at?: string | null;
  created_at: string;
}

// ============================================
// Service catalog
//
// The catalog is a set of *scope templates*, not a price list. Selecting
// an item seeds a proposal line with its name and (where we have one) a
// suggested starting amount; the agent edits the one-time price, the
// monthly price and the scope note before anything is generated or sent.
// Nothing here is a locked customer price.
// ============================================

export interface ServiceCatalogItem {
  id: string;
  name: string;
  group: ServiceGroup;
  /** Internal starting point for the one-time amount. Always editable. */
  suggested_one_time?: number;
  /** Internal starting point for the monthly amount. Always editable. */
  suggested_monthly?: number;
  /** Placeholder copy for the scope note field. Never auto-filled. */
  scope_hint?: string;
}

export type ServiceGroup =
  | "websites"
  | "marketing"
  | "media"
  | "custom"
  | "addons";

export const SERVICE_GROUPS: { id: ServiceGroup; label: string }[] = [
  { id: "websites", label: "Websites" },
  { id: "marketing", label: "Marketing & Ads" },
  { id: "media", label: "Drone & Media" },
  { id: "custom", label: "Custom Development" },
  { id: "addons", label: "Add-Ons" },
];

export const SERVICE_CATALOG: ServiceCatalogItem[] = [
  // --- Websites ---
  {
    id: "new-business-launch",
    name: "New Business Launch",
    group: "websites",
    suggested_one_time: 2500,
    scope_hint:
      "Core pages, brand basics, lead form, Google Business Profile, launch support.",
  },
  {
    id: "custom-business-website",
    name: "Custom Business Website",
    group: "websites",
    suggested_one_time: 3500,
    scope_hint:
      "Custom design, service pages, lead capture, analytics, mobile optimization.",
  },
  {
    id: "local-growth-system",
    name: "Local Growth System",
    group: "websites",
    suggested_one_time: 6500,
    scope_hint:
      "Full site build, service-area architecture, local SEO foundation, conversion tracking.",
  },
  // --- Marketing & Ads ---
  {
    id: "paid-ads-management",
    name: "Paid Ads Management",
    group: "marketing",
    suggested_monthly: 1500,
    scope_hint:
      "Campaign build and ongoing management. Note the channels and ad-spend range.",
  },
  {
    id: "local-lead-generation",
    name: "Local Lead Generation",
    group: "marketing",
    scope_hint: "Local search, maps, and landing pages tuned to inbound calls and forms.",
  },
  {
    id: "full-growth-management",
    name: "Full Growth / Acquisition Management",
    group: "marketing",
    scope_hint:
      "End-to-end acquisition: ads, landing pages, tracking, and monthly strategy.",
  },
  // --- Drone & Media ---
  {
    id: "drone-photo-video",
    name: "Drone Photography / Video",
    group: "media",
    scope_hint: "Aerial stills and video. Note shoot count, locations, and deliverables.",
  },
  {
    id: "business-photo-video",
    name: "Business Photo / Video Content",
    group: "media",
    scope_hint: "On-site photo and video. Note shoot length and edited deliverables.",
  },
  {
    id: "custom-media-package",
    name: "Custom Media Package",
    group: "media",
    scope_hint: "Combined media scope built around the client's goals.",
  },
  // --- Custom Development ---
  {
    id: "web-application-portal",
    name: "Web Application / Client Portal",
    group: "custom",
    scope_hint: "Accounts, dashboards, and workflows. Note the core features in scope.",
  },
  {
    id: "automation-ai-system",
    name: "Automation & AI System",
    group: "custom",
    scope_hint: "Workflow automation or AI assist. Note the systems being connected.",
  },
  {
    id: "ecommerce-storefront",
    name: "E-Commerce / Storefront",
    group: "custom",
    scope_hint: "Catalog, checkout, and fulfillment integration.",
  },
  {
    id: "landing-page-funnel",
    name: "Landing Page / Funnel",
    group: "custom",
    scope_hint: "Focused landing page or multi-step funnel with tracking.",
  },
  {
    id: "custom-development",
    name: "Custom Development",
    group: "custom",
    scope_hint: "Scoped engineering work. Describe the build in one or two lines.",
  },
  // --- Add-Ons ---
  {
    id: "local-seo-city-pages",
    name: "Local SEO / City Pages",
    group: "addons",
    scope_hint: "Service-area pages and on-page local SEO. Note page count or cadence.",
  },
  {
    id: "google-business-profile",
    name: "Google Business Profile Optimization",
    group: "addons",
    scope_hint: "Profile build-out, categories, photos, posts, and Q&A.",
  },
  {
    id: "analytics-conversion-tracking",
    name: "Analytics & Conversion Tracking",
    group: "addons",
    suggested_one_time: 350,
    scope_hint: "GA4, call and form tracking, conversion events, reporting view.",
  },
  {
    id: "review-reputation-system",
    name: "Review / Reputation System",
    group: "addons",
    scope_hint: "Review requests, monitoring, and response workflow.",
  },
  {
    id: "crm-lead-follow-up",
    name: "CRM / Lead Follow-Up Automation",
    group: "addons",
    scope_hint: "Lead routing, follow-up sequences, and pipeline visibility.",
  },
  {
    id: "maintenance-support",
    name: "Maintenance / Ongoing Support",
    group: "addons",
    suggested_monthly: 297,
    scope_hint: "Hosting, updates, backups, monitoring, and small monthly changes.",
  },
];

export const BUSINESS_TYPES = [
  "Home Services",
  "Contractor / Trades",
  "Garage Door Contractor",
  "HVAC",
  "Plumbing",
  "Electrical",
  "Roofing",
  "Landscaping / Outdoor",
  "Construction / Remodeling",
  "Auto Dealer",
  "Restaurant",
  "Professional Services",
  "Real Estate",
  "Retail",
  "E-Commerce",
  "Health & Wellness",
  "Other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];
