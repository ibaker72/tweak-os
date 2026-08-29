import {
  SERVICE_CATALOG,
  type ProposalService,
  type ProposalTotals,
  type ServiceCatalogItem,
} from "./types";

// ============================================
// Proposal service lines
//
// One place to read, normalize, total, and format the line items on a
// proposal. Everything that touches `services_json` — the UI, the API
// routes, the generator — goes through here, so a proposal written by
// the legacy fixed-package catalog reads back exactly as accurately as
// one written today. Nothing rewrites stored rows; normalization is a
// read-time concern.
//
// Money is whole dollars (the convention `proposals.services_json` has
// always used). Amounts are summed as-is — no scaling, no float math
// beyond addition — so totals stay exact for integer inputs.
// ============================================

/**
 * Coerce a stored amount into a usable number. Accepts the numbers we
 * write and the numeric strings a jsonb round-trip can produce. Anything
 * else — null, NaN, negative, an empty string — is "no amount", which is
 * different from zero and lets a priced-later line stay unpriced.
 */
export function toMoney(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

interface RawService {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  one_time_price?: unknown;
  monthly_price?: unknown;
  price?: unknown;
  billing?: unknown;
  secondary?: unknown;
}

/**
 * Normalize one stored line into the current shape.
 *
 * Current lines pass through. Legacy lines (`{ name, price, billing }`)
 * map their single amount into the matching bucket — `billing: "monthly"`
 * to `monthly_price`, anything else to `one_time_price` — and a legacy
 * `secondary` amount is added to its own bucket so a line that carried
 * both a build fee and a retainer keeps both.
 *
 * Returns null for anything without a usable name.
 */
export function normalizeService(raw: unknown): ProposalService | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawService;

  const name = readString(r.name);
  if (!name) return null;

  const out: ProposalService = { name };
  const id = readString(r.id);
  if (id) out.id = id;
  const description = readString(r.description);
  if (description) out.description = description;

  const oneTime = toMoney(r.one_time_price);
  const monthly = toMoney(r.monthly_price);

  if (oneTime !== undefined || monthly !== undefined) {
    // Already in the current shape — the legacy fields, if any, are a
    // duplicate of what we just read and must not be counted twice.
    if (oneTime !== undefined) out.one_time_price = oneTime;
    if (monthly !== undefined) out.monthly_price = monthly;
    return out;
  }

  const legacyPrice = toMoney(r.price);
  if (legacyPrice !== undefined) {
    if (r.billing === "monthly") out.monthly_price = legacyPrice;
    else out.one_time_price = legacyPrice;
  }

  if (r.secondary && typeof r.secondary === "object") {
    const secondary = r.secondary as { price?: unknown; billing?: unknown };
    const secondaryPrice = toMoney(secondary.price);
    if (secondaryPrice !== undefined) {
      if (secondary.billing === "monthly") {
        out.monthly_price = (out.monthly_price ?? 0) + secondaryPrice;
      } else {
        out.one_time_price = (out.one_time_price ?? 0) + secondaryPrice;
      }
    }
  }

  return out;
}

/** Normalize a whole `services_json` payload. Tolerates null and junk. */
export function normalizeServices(raw: unknown): ProposalService[] {
  if (!Array.isArray(raw)) return [];
  const out: ProposalService[] = [];
  for (const entry of raw) {
    const svc = normalizeService(entry);
    if (svc) out.push(svc);
  }
  return out;
}

/**
 * One-time and monthly totals, kept strictly separate. Accepts stored
 * (possibly legacy) lines as well as current ones.
 */
export function calculateTotals(services: unknown): ProposalTotals {
  let total_one_time = 0;
  let total_monthly = 0;
  for (const svc of normalizeServices(services)) {
    total_one_time += svc.one_time_price ?? 0;
    total_monthly += svc.monthly_price ?? 0;
  }
  return { total_one_time, total_monthly };
}

export function hasPricing(svc: ProposalService): boolean {
  return (svc.one_time_price ?? 0) > 0 || (svc.monthly_price ?? 0) > 0;
}

export function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** "$4,800 one-time + $750/mo" — used in the composer and the prompt. */
export function formatServicePricing(svc: ProposalService): string {
  const parts: string[] = [];
  if ((svc.one_time_price ?? 0) > 0) {
    parts.push(`${formatMoney(svc.one_time_price as number)} one-time`);
  }
  if ((svc.monthly_price ?? 0) > 0) {
    parts.push(`${formatMoney(svc.monthly_price as number)}/mo`);
  }
  return parts.length > 0 ? parts.join(" + ") : "Price to be scoped";
}

// ============================================
// Catalog helpers
// ============================================

export function findCatalogItem(id: string): ServiceCatalogItem | undefined {
  return SERVICE_CATALOG.find((item) => item.id === id);
}

/**
 * Seed a proposal line from a catalog template. Suggested amounts are a
 * starting point for the agent, never a locked price — the composer
 * makes both editable before anything is generated or sent.
 */
export function serviceFromCatalogItem(item: ServiceCatalogItem): ProposalService {
  const svc: ProposalService = { id: item.id, name: item.name };
  if (item.suggested_one_time !== undefined) {
    svc.one_time_price = item.suggested_one_time;
  }
  if (item.suggested_monthly !== undefined) {
    svc.monthly_price = item.suggested_monthly;
  }
  return svc;
}

/** Muted hint under a catalog item, e.g. "Starting at $2,500 one-time". */
export function catalogSuggestionLabel(item: ServiceCatalogItem): string {
  const parts: string[] = [];
  if (item.suggested_one_time !== undefined) {
    parts.push(`${formatMoney(item.suggested_one_time)} one-time`);
  }
  if (item.suggested_monthly !== undefined) {
    parts.push(`${formatMoney(item.suggested_monthly)}/mo`);
  }
  return parts.length > 0 ? `Starting at ${parts.join(" + ")}` : "Custom scoped";
}

// ============================================
// Investment summary
//
// Deterministic: built from the selected line items, never from model
// output, so the numbers a client reads are exactly the numbers the
// agent entered.
// ============================================

const NO_SCOPE_INVESTMENT =
  "Pricing will be confirmed after the discovery call once scope is locked in.";

export function buildInvestmentSummary(
  services: unknown,
  totals?: ProposalTotals
): string {
  const lines = normalizeServices(services);
  if (lines.length === 0) return NO_SCOPE_INVESTMENT;

  const sums = totals ?? calculateTotals(lines);
  const rows = lines.map((svc) => {
    const oneTime = (svc.one_time_price ?? 0) > 0
      ? formatMoney(svc.one_time_price as number)
      : "—";
    const monthly = (svc.monthly_price ?? 0) > 0
      ? `${formatMoney(svc.monthly_price as number)}/month`
      : "—";
    return `| ${svc.name} | ${oneTime} | ${monthly} |`;
  });

  const out = [
    "| Service | One-Time | Monthly |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ];

  if (sums.total_one_time > 0 || sums.total_monthly === 0) {
    out.push(`**Total One-Time Investment:** ${formatMoney(sums.total_one_time)}`);
  }
  if (sums.total_monthly > 0) {
    out.push(
      `**Monthly Ongoing Investment:** ${formatMoney(sums.total_monthly)}/month`
    );
  }
  return out.join("\n");
}
