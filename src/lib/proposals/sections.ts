import {
  SECTION_ORDER,
  SECTION_TITLES,
  type ProposalSections,
  type ProposalService,
  type ProposalTotals,
} from "./types";

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
  selected_services: ProposalService[];
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
  const investment = buildInvestmentSummary(ctx);
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
  if (ctx.selected_services.length === 0) {
    return "Once we know your priorities on the discovery call, we will recommend a focused build that ties directly to the opportunities above.";
  }
  const suffix = ctx.website_url ? ` (${ctx.website_url})` : "";
  const lines: string[] = [];
  lines.push(
    `Based on the findings above and what you have in place today${suffix}, here is what we recommend:`
  );
  lines.push("");
  for (const svc of ctx.selected_services) {
    lines.push(`- **${svc.name}** — ${reasonForService(svc.name)}`);
  }
  return lines.join("\n");
}

function reasonForService(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("foundation")) return "a clean, fast, mobile-first site that establishes credibility and captures inbound demand.";
  if (n.includes("growth website")) return "a conversion-focused build with the pages local buyers actually search for.";
  if (n.includes("premium growth")) return "a full website system with ongoing optimization — built for compounding lead growth.";
  if (n.includes("dealership")) return "a dealership-grade system tuned for inventory, leads, and walk-in foot traffic.";
  if (n.includes("ads starter")) return "a tight paid search campaign focused on the highest-intent local keywords.";
  if (n.includes("full-funnel")) return "ads, landing pages, and tracking working together so we can see what is actually producing leads.";
  if (n.includes("growth partnership")) return "an ongoing growth retainer — strategy, content, and ads under one roof.";
  if (n.includes("ai local seo")) return "programmatic local pages so the site shows up in more nearby searches.";
  if (n.includes("monthly seo")) return "month-over-month maintenance to keep the site healthy and ranking.";
  if (n.includes("ga4")) return "proper tracking so we can attribute leads to channels and double down on what works.";
  if (n.includes("cro")) return "a deep look at where visitors drop off, with a prioritized fix list.";
  return "a focused workstream tied to one of the opportunities above.";
}

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function buildInvestmentSummary(ctx: DefaultSectionContext): string {
  if (ctx.selected_services.length === 0) {
    return "Pricing will be confirmed after the discovery call once scope is locked in.";
  }
  const rows = ctx.selected_services
    .map((s) => `| ${s.name} | ${fmtMoney(s.price)} | ${s.billing === "monthly" ? "Monthly" : "One-time"} |`)
    .join("\n");
  return [
    "| Service | Price | Billing |",
    "| --- | --- | --- |",
    rows,
    "",
    `**Total One-Time:** ${fmtMoney(ctx.totals.total_one_time)}`,
    `**Total Monthly:** ${fmtMoney(ctx.totals.total_monthly)}/mo`,
  ].join("\n");
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
