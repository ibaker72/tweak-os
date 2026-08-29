import {
  SECTION_ORDER,
  SECTION_TITLES,
  type ProposalSections,
  type ProposalTotals,
  type StoredProposalService,
} from "./types";
import {
  buildInvestmentSummary,
  formatServicePricing,
  normalizeServices,
} from "./services";

/**
 * Convert a raw markdown proposal (as produced by the LLM) into the
 * seven editable sections used by the composer. Falls back gracefully
 * if a section is missing — empty string lets the user fill it in.
 */
export function parseSectionsFromMarkdown(
  markdown: string
): ProposalSections {
  const sections: ProposalSections = emptySections();
  if (!markdown.trim()) return sections;

  const lines = markdown.split(/\r?\n/);
  let current: keyof ProposalSections | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current) {
      sections[current] = buffer.join("\n").trim();
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      flush();
      current = matchSection(headingMatch[1]);
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return sections;
}

function matchSection(title: string): keyof ProposalSections | null {
  const t = title.toLowerCase();
  if (t.includes("executive")) return "executive_summary";
  if (t.includes("found")) return "what_we_found";
  if (t.includes("recommend")) return "our_recommendation";
  if (t.includes("investment") || t.includes("pricing")) return "investment_summary";
  if (t.includes("next") || t.includes("happens")) return "what_happens_next";
  if (t.includes("about")) return "about";
  if (t.includes("note")) return "custom_notes";
  return null;
}

export function emptySections(): ProposalSections {
  return {
    executive_summary: "",
    what_we_found: "",
    our_recommendation: "",
    investment_summary: "",
    what_happens_next: "",
    about: "",
    custom_notes: "",
  };
}

/** Stitch the sections back into a single markdown document. */
export function sectionsToMarkdown(sections: ProposalSections): string {
  const parts: string[] = [];
  for (const key of SECTION_ORDER) {
    const body = sections[key]?.trim();
    if (!body) continue;
    parts.push(`## ${SECTION_TITLES[key]}`, "", body, "");
  }
  return parts.join("\n").trim();
}

/** Build a plain-text fallback (for copy/paste and email previews). */
export function sectionsToPlainText(sections: ProposalSections): string {
  const parts: string[] = [];
  for (const key of SECTION_ORDER) {
    const body = sections[key]?.trim();
    if (!body) continue;
    parts.push(`${SECTION_TITLES[key].toUpperCase()}`);
    parts.push("");
    parts.push(stripMarkdown(body));
    parts.push("");
  }
  return parts.join("\n").trim();
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}

// ============================================
// Default starter text — used before the LLM streams in OR if the user
// opens the composer without generating a proposal at all.
// ============================================

export interface DefaultSectionContext {
  client_name: string;
  business_type: string;
  website_url: string;
  /** Accepts legacy line shapes too — normalized before use. */
  selected_services: readonly StoredProposalService[];
  totals: ProposalTotals;
  notes?: string;
}

export function buildDefaultSections(
  ctx: DefaultSectionContext
): ProposalSections {
  const name = ctx.client_name || "your business";
  const biz = ctx.business_type || "your industry";
  const summary =
    `${name} has solid fundamentals in ${biz.toLowerCase()}, and there is a strong opportunity to capture more local search demand.`;

  const findings: string[] = [
    `The current ${biz.toLowerCase()} sites we see in your area often miss a clear "get a quote" or "book service" call-to-action above the fold.`,
    "Page speed and mobile usability are common drop-off points — small fixes here usually lift conversions noticeably.",
    "Most local sites are under-optimized for the searches that actually drive calls and quote requests.",
  ];

  const recommendation = buildRecommendation(ctx);
  const investment = buildInvestmentSummary(ctx.selected_services, ctx.totals);
  const whatsNext = [
    "1. **Discovery call** — we walk through your goals, current numbers, and where the biggest wins are (30-45 min).",
    "2. **Build phase** — design, copy, and development on the scoped services. We share progress in a shared workspace so you can review as we go.",
    "3. **Launch & measure** — site goes live, tracking is verified, and we check in monthly to keep improving.",
  ].join("\n");

  const about = `Tweak & Build is a founder-led product engineering studio based in New Jersey. We build custom websites and growth systems for local businesses — including speedwaymotorsllc.com and ppmechanicalllc.com — that generate real leads, not just traffic.`;

  return {
    executive_summary: summary,
    what_we_found: findings.map((f) => `- ${f}`).join("\n"),
    our_recommendation: recommendation,
    investment_summary: investment,
    what_happens_next: whatsNext,
    about,
    custom_notes: ctx.notes?.trim() ?? "",
  };
}

function buildRecommendation(ctx: DefaultSectionContext): string {
  const services = normalizeServices(ctx.selected_services);
  if (services.length === 0) {
    return "Once we know your priorities on the discovery call, we will recommend a focused build that ties directly to the opportunities above.";
  }
  const suffix = ctx.website_url ? ` (${ctx.website_url})` : "";
  const lines: string[] = [];
  lines.push(
    `Based on the findings above and what you have in place today${suffix}, here is the scope we recommend:`
  );
  lines.push("");
  for (const svc of services) {
    // A scope note the agent wrote beats any generic rationale we have.
    const detail = svc.description?.trim() || reasonForService(svc.name);
    lines.push(`- **${svc.name}** (${formatServicePricing(svc)}) — ${detail}`);
  }
  return lines.join("\n");
}

/**
 * Fallback one-liner for a service with no scope note. Covers the current
 * catalog first, then the legacy package names so an old proposal
 * regenerated today still reads correctly.
 */
function reasonForService(name: string): string {
  const n = name.toLowerCase();
  // Current catalog
  if (n.includes("new business launch")) return "everything a new business needs to open online — site, profile, and a way to capture the first calls.";
  if (n.includes("custom business website")) return "a custom, fast, mobile-first site built around how your customers actually buy.";
  if (n.includes("local growth system")) return "a full site and local search system built to compound — pages, tracking, and service-area coverage.";
  if (n.includes("paid ads")) return "campaigns built and managed against the searches that produce real calls and quote requests.";
  if (n.includes("local lead generation")) return "local search, maps, and landing pages working together to bring in nearby demand.";
  if (n.includes("full growth") || n.includes("acquisition management")) return "end-to-end acquisition — ads, pages, tracking, and monthly strategy under one roof.";
  if (n.includes("drone")) return "aerial photo and video that shows the scale and quality of your work.";
  if (n.includes("photo") || n.includes("video") || n.includes("media")) return "original photo and video so the site sells your actual work, not stock imagery.";
  if (n.includes("web application") || n.includes("portal")) return "a custom application built around your workflow instead of a generic tool.";
  if (n.includes("automation") || n.includes("ai system")) return "automation that removes manual steps between a new lead and a booked job.";
  if (n.includes("commerce") || n.includes("storefront")) return "a storefront built for the way your catalog and fulfillment actually work.";
  if (n.includes("landing page") || n.includes("funnel")) return "a focused page built for one conversion, with tracking to prove what it produces.";
  if (n.includes("custom development")) return "scoped engineering work tied directly to the goals above.";
  if (n.includes("local seo") || n.includes("city page")) return "service-area pages so the site shows up in more of the nearby searches that matter.";
  if (n.includes("google business profile")) return "a fully built-out profile — the first thing most local buyers see before your site.";
  if (n.includes("analytics") || n.includes("conversion tracking") || n.includes("ga4")) return "proper tracking so we can attribute leads to channels and double down on what works.";
  if (n.includes("review") || n.includes("reputation")) return "a steady flow of new reviews and a workflow for responding to them.";
  if (n.includes("crm") || n.includes("follow-up")) return "follow-up that runs automatically so no inbound lead goes cold.";
  if (n.includes("maintenance") || n.includes("support") || n.includes("care plan")) return "hosting, updates, and monitoring so the site stays fast and secure.";
  // Legacy package names — historical proposals only
  if (n.includes("foundation")) return "a clean, fast, mobile-first site that establishes credibility and captures inbound demand.";
  if (n.includes("growth website")) return "a conversion-focused build with the pages local buyers actually search for.";
  if (n.includes("premium growth")) return "a full website system with ongoing optimization — built for compounding lead growth.";
  if (n.includes("dealership")) return "a dealership-grade system tuned for inventory, leads, and walk-in foot traffic.";
  if (n.includes("ads starter") || n.includes("full-funnel")) return "ads, landing pages, and tracking working together so we can see what is actually producing leads.";
  if (n.includes("growth partnership")) return "an ongoing growth retainer — strategy, content, and ads under one roof.";
  if (n.includes("cro")) return "a deep look at where visitors drop off, with a prioritized fix list.";
  return "a focused workstream tied to one of the opportunities above.";
}

// ============================================
// Slug helper for filenames
// ============================================
export function slugifyClient(name: string): string {
  const s = (name || "client")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "client";
}
