// Canonical identity for a lead.
//
// A partner keeps prospects in a Google Sheet, exports it as CSV, adds more
// rows, and exports the same sheet again. The second file contains every row
// from the first, so the importer's only defence against duplicating them is
// recognising that two differently-typed rows describe one business:
//
//   (862) 555-1212   8625551212   +18625551212
//   TEST@Example.com                 test@example.com
//   https://www.example.com/   http://example.com   example.com/contact
//   "ABC Plumbing LLC"               "ABC Plumbing, LLC"
//
// Every function here answers "what is this value, ignoring formatting". They
// are pure and free of any server-only import so the upload screen can use
// them, but they are NOT where the decision is made: duplicate detection runs
// inside private.find_duplicate_lead() in migration 00023, against every lead
// in the table rather than the ones the caller happens to be allowed to read.
//
// The SQL there mirrors this file function for function, and
// supabase/tests/lead-dedupe.test.ts feeds the same fixture table through both
// and fails if they disagree. Change one half and that test tells you.

import { normalizePhoneNumber } from "@/lib/phone";

/** The keys a row is matched on, in the order the policy trusts them. */
export interface DedupeKeys {
  external: string | null;
  phone: string | null;
  email: string | null;
  domain: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
}

export type DuplicateMatchReason =
  | "external_id"
  | "phone"
  | "email"
  | "domain"
  | "name_location";

/**
 * Hosts that identify a platform rather than a business.
 *
 * A domain is a strong signal precisely because a business owns it. These are
 * owned by nobody in particular: half the sole traders in a niche list a Gmail
 * address or a Facebook page as their website, and matching on one would
 * collapse them into a single lead.
 */
const SHARED_WEB_HOSTS = new Set([
  // Free mailbox providers, which people paste into a Website column.
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "aol.com", "icloud.com", "me.com",
  "mac.com", "protonmail.com", "proton.me", "mail.com", "gmx.com",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "optonline.net",
  // Social and directory presences.
  "facebook.com", "m.facebook.com", "instagram.com", "linkedin.com",
  "twitter.com", "x.com", "tiktok.com", "youtube.com", "pinterest.com",
  "nextdoor.com", "yelp.com", "yellowpages.com", "superpages.com",
  "whitepages.com", "manta.com", "bbb.org", "angi.com", "angieslist.com",
  "homeadvisor.com", "thumbtack.com", "houzz.com", "porch.com",
  "mapquest.com", "foursquare.com", "tripadvisor.com", "trustpilot.com",
  "chamberofcommerce.com", "merchantcircle.com", "citysearch.com",
  "google.com", "sites.google.com", "business.site", "goo.gl", "linktr.ee",
  // Site builders that hand out a shared apex.
  "wixsite.com", "wix.com", "squarespace.com", "godaddysites.com",
  "weebly.com", "wordpress.com", "blogspot.com", "webnode.com",
  "myshopify.com", "square.site", "wordpress.org",
]);

/**
 * Words that describe what a business does, not which business it is.
 *
 * The name tier only ever runs when there is no phone, email or domain to go
 * on, and a name made of nothing but these is not an identifier — a sheet of
 * "Plumbing", "Auto Repair" and "Cleaning Services" rows would otherwise
 * collapse to one lead per town.
 */
const GENERIC_NAME_TOKENS = new Set([
  "the", "and", "of", "for", "a", "an",
  "plumbing", "plumber", "plumbers", "hvac", "heating", "cooling", "air",
  "conditioning", "electric", "electrical", "electrician", "electricians",
  "roofing", "roofer", "roofers", "landscaping", "landscape", "lawn", "care",
  "cleaning", "cleaners", "cleaner", "maid", "janitorial", "construction",
  "contracting", "contractor", "contractors", "builders", "building",
  "remodeling", "renovation", "restoration", "painting", "painters", "paving",
  "concrete", "masonry", "flooring", "carpet", "tile", "windows", "doors",
  "fencing", "decking", "pool", "pools", "pest", "control", "exterminator",
  "security", "locksmith", "towing", "auto", "automotive", "repair", "repairs",
  "mechanic", "body", "shop", "tire", "tires", "movers", "moving", "storage",
  "salon", "spa", "barber", "barbers", "nails", "hair", "beauty", "massage",
  "dental", "dentist", "medical", "clinic", "health", "wellness", "fitness",
  "gym", "studio", "bakery", "cafe", "coffee", "restaurant", "pizza", "pizzeria",
  "deli", "catering", "grill", "kitchen", "market", "grocery", "store", "shop",
  "services", "service", "solutions", "systems", "group", "holdings",
  "enterprises", "associates", "partners", "brothers", "sons", "family",
  "professional", "quality", "affordable", "best", "local", "premier",
]);

/**
 * Suffixes stripped off the end of a business name.
 *
 * "ABC Plumbing LLC" and "ABC Plumbing" are the same business written twice.
 * Stripped repeatedly because sheets carry "Smith & Sons Co LLC".
 */
const LEGAL_SUFFIXES = new Set([
  "llc", "lc", "llp", "lp", "pllc", "plc", "pc", "pa", "inc", "incorporated",
  "corp", "corporation", "co", "company", "ltd", "limited", "gmbh", "sa",
  "dba", "trust", "trustee",
]);

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR",
  "VI", "GU", "AS", "MP",
]);

const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN",
  iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX",
  utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC", "puerto rico": "PR",
};

function blank(raw: string | null | undefined): raw is null | undefined {
  return raw == null || raw.trim() === "";
}

/** Case-folded, whitespace-trimmed address, or null when it is not one. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;
  const value = raw.trim().toLowerCase().replace(/\s+/g, "");
  // Deliberately loose. The job is to fold TEST@Example.com onto
  // test@example.com, not to decide whether the mailbox exists.
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) ? value : null;
}

/**
 * The host a URL points at, with the noise that varies between copies of the
 * same address removed: scheme, credentials, port, path, query, fragment,
 * a leading `www.` and a trailing dot.
 *
 *   https://www.example.com/  ->  example.com
 *   http://example.com        ->  example.com
 *   example.com/contact       ->  example.com
 */
export function normalizeDomain(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;

  let value = raw.trim().toLowerCase().replace(/\s+/g, "");
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^\/+/, "");
  // Credentials, but only in the authority — an '@' after the first '/' is path.
  const authority = value.split(/[/?#]/, 1)[0];
  const at = authority.lastIndexOf("@");
  value = at >= 0 ? authority.slice(at + 1) : authority;
  value = value.replace(/:\d+$/, "");
  value = value.replace(/^www\./, "");
  value = value.replace(/\.+$/, "");

  if (!value || !value.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(value)) return null;
  if (value.split(".").some((label) => label === "")) return null;
  // A real registrable name ends in an alphabetic TLD; this rejects bare IPs
  // and half-typed values like "example." or "10.0.0.1".
  if (!/\.[a-z]{2,}$/.test(value)) return null;

  return value;
}

/**
 * Comparable form of a business name: case-folded, punctuation-insensitive,
 * whitespace-collapsed, with trailing legal suffixes removed.
 *
 *   "ABC Plumbing LLC"  ->  "abc plumbing"
 *   "ABC Plumbing, LLC" ->  "abc plumbing"
 *   "A.B.C. Plumbing"   ->  "abc plumbing"
 */
export function normalizeBusinessName(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;

  let value = raw.trim().toLowerCase();
  value = value.replace(/&/g, " and ");
  // Dots and apostrophes close up ("A.B.C." -> "abc"); every other separator
  // becomes a space so "smith-jones" and "smith jones" agree.
  value = value.replace(/[.'‘’ʼ]/g, "");
  value = value.replace(/[^a-z0-9]+/g, " ").trim();
  if (!value) return null;

  const tokens = value.split(" ");
  const trimmed = [...tokens];
  while (trimmed.length > 1 && LEGAL_SUFFIXES.has(trimmed[trimmed.length - 1])) {
    trimmed.pop();
  }
  // A business actually called "The Company" keeps its name rather than
  // normalizing to nothing.
  return (trimmed.length > 0 ? trimmed : tokens).join(" ");
}

/** Lower-cased city with punctuation and doubled spaces removed. */
export function normalizeCity(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/[.'‘’ʼ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return value || null;
}

/** Two-letter code for a US state, however it was written. */
export function normalizeState(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;
  const value = raw.trim().toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
  if (!value) return null;

  const mapped = US_STATE_NAME_TO_CODE[value];
  if (mapped) return mapped;

  const upper = value.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;

  // Not a US state we recognise. Keep it rather than dropping it: it still
  // distinguishes two rows, it just does not get folded onto a code.
  return upper;
}

// ---------------------------------------------------------------------------
// Dedupe keys — a normalized value, plus the policy guard for that tier.
// ---------------------------------------------------------------------------

export function externalIdKey(raw: string | null | undefined): string | null {
  if (blank(raw)) return null;
  return raw.trim().toLowerCase();
}

export function phoneKey(raw: string | null | undefined): string | null {
  return normalizePhoneNumber(raw);
}

export function emailKey(raw: string | null | undefined): string | null {
  return normalizeEmail(raw);
}

/** A domain, unless it belongs to a platform every business can sign up to. */
export function domainKey(raw: string | null | undefined): string | null {
  const domain = normalizeDomain(raw);
  if (domain === null) return null;
  if (SHARED_WEB_HOSTS.has(domain)) return null;
  // A free subdomain ("joes-diner.wixsite.com") is the business's own, but a
  // bare builder apex is not; the check above already removed those.
  return domain;
}

/**
 * A name, unless it says only what the business does.
 *
 * Legal suffixes count as filler here too. A row whose name normalizes to
 * nothing but "llc" carries no identity, and matching two of those together
 * would merge two unrelated businesses on the strength of their paperwork.
 */
export function nameKey(raw: string | null | undefined): string | null {
  const name = normalizeBusinessName(raw);
  if (name === null) return null;
  if (name.replace(/\s/g, "").length < 3) return null;
  const informative = name
    .split(" ")
    .some((token) => !GENERIC_NAME_TOKENS.has(token) && !LEGAL_SUFFIXES.has(token));
  return informative ? name : null;
}

/**
 * The composite the name tier compares on: `city|state`.
 *
 * Returns null when neither part is known, which switches the name tier off
 * for that row — a bare name with no location is not enough to merge on.
 */
export function localityKey(
  city: string | null | undefined,
  state: string | null | undefined
): string | null {
  const c = normalizeCity(city);
  const s = normalizeState(state);
  if (c === null && s === null) return null;
  return `${c ?? ""}|${s ?? ""}`;
}

export function dedupeKeysFor(row: {
  business_name?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  external_id?: string | null;
}): DedupeKeys {
  return {
    external: externalIdKey(row.external_id),
    phone: phoneKey(row.phone),
    email: emailKey(row.email),
    domain: domainKey(row.website),
    name: nameKey(row.business_name),
    city: normalizeCity(row.city),
    state: normalizeState(row.state),
  };
}

/**
 * Do two rows sit in places that cannot both be true?
 *
 * Only a stated disagreement counts. A missing city or state is unknown, not
 * different — the same sheet re-exported often loses a column, and treating
 * that as a conflict would let the row through as a new lead.
 *
 * This is what keeps two locations of one franchise apart when they share a
 * corporate domain or an info@ address, without breaking the re-upload case.
 */
export function localityConflicts(a: DedupeKeys, b: DedupeKeys): boolean {
  if (a.city !== null && b.city !== null && a.city !== b.city) return true;
  if (a.state !== null && b.state !== null && a.state !== b.state) return true;
  return false;
}

/**
 * The policy, in one place: which tier (if any) makes `row` a duplicate of
 * `existing`.
 *
 * Order is strength order. external_id is an identifier someone else assigned
 * and a phone number is answered by one business, so those two are
 * unconditional. An email and a domain are owned, but a franchise can share
 * either across its branches, so those defer to a stated location
 * disagreement. Name is the fallback and defers to the same rule.
 *
 * What keeps the name tier honest is nameKey(), which returns null for a name
 * made only of words describing the trade — a sheet of "Plumbing" and "Auto
 * Repair" rows never reaches this tier.
 */
export function duplicateReason(
  row: DedupeKeys,
  existing: DedupeKeys
): DuplicateMatchReason | null {
  if (row.external !== null && row.external === existing.external) return "external_id";
  if (row.phone !== null && row.phone === existing.phone) return "phone";

  const conflict = localityConflicts(row, existing);
  if (row.email !== null && row.email === existing.email && !conflict) return "email";
  if (row.domain !== null && row.domain === existing.domain && !conflict) return "domain";

  if (row.name !== null && row.name === existing.name && !conflict) {
    return "name_location";
  }

  return null;
}

/** Wording the import summary shows next to a skipped row. */
export function describeDuplicateReason(reason: string | null | undefined): string {
  switch (reason) {
    case "external_id":
      return "Skipped: existing record ID match";
    case "phone":
      return "Skipped: existing phone match";
    case "email":
      return "Skipped: existing email match";
    case "domain":
      return "Skipped: existing domain match";
    case "name_location":
      return "Skipped: existing name + location match";
    default:
      return "Skipped: lead already exists";
  }
}
