import * as cheerio from "cheerio";
import type { DiscoveryInput } from "./types";
import { searchGooglePlaces, getPlaceDetails, type GooglePlaceResult } from "./google-places";
import { searchGoogleCustom, buildSearchQuery } from "./google-search";

export interface DiscoveredBusiness {
  business_name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  phone: string | null;
  source: string;
  niche: string | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  category: string | null;
  address: string | null;
}

const FETCH_TIMEOUT = 8_000;

// Domains that are directories, platforms, or aggregators — not real business websites
const BLOCKED_DOMAINS = new Set([
  "yelp.com",
  "google.com",
  "google.co.uk",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "pinterest.com",
  "reddit.com",
  "yellowpages.com",
  "mapquest.com",
  "bbb.org",
  "angieslist.com",
  "angi.com",
  "homeadvisor.com",
  "thumbtack.com",
  "nextdoor.com",
  "manta.com",
  "chamberofcommerce.com",
  "merchantcircle.com",
  "citysearch.com",
  "superpages.com",
  "whitepages.com",
  "foursquare.com",
  "tripadvisor.com",
  "trustpilot.com",
  "glassdoor.com",
  "indeed.com",
  "craigslist.org",
  "amazon.com",
  "ebay.com",
  "etsy.com",
  "walmart.com",
  "target.com",
  "apple.com",
  "microsoft.com",
  "wikipedia.org",
  "github.com",
  "medium.com",
  "wordpress.com",
  "blogspot.com",
  "tumblr.com",
  "wix.com",
  "squarespace.com",
  "weebly.com",
  "godaddy.com",
  "maps.google.com",
  "news.google.com",
  "play.google.com",
  "docs.google.com",
  "drive.google.com",
]);

export interface UrlValidationResult {
  url: string;
  normalized: string | null;
  valid: boolean;
  reason?: string;
}

/**
 * Normalize a raw URL string into a clean https URL.
 * Returns null if the input cannot be parsed as a valid domain.
 */
function normalizeUrl(raw: string): string | null {
  let cleaned = raw.trim();
  if (!cleaned) return null;

  // Strip trailing slashes, whitespace, trailing punctuation
  cleaned = cleaned.replace(/[/\s.,;]+$/, "");

  // Remove leading protocol noise
  cleaned = cleaned.replace(/^(https?:\/\/)+/i, "");

  // Strip leading www. for consistency, we'll add https:// back
  cleaned = cleaned.replace(/^www\./i, "");

  // Must have at least one dot to be a domain
  if (!cleaned.includes(".")) return null;

  // Reject obvious non-URLs (emails, file paths)
  if (cleaned.includes("@") || cleaned.includes(" ")) return null;

  const fullUrl = `https://${cleaned}`;

  try {
    const parsed = new URL(fullUrl);
    // Verify hostname has a valid TLD
    const parts = parsed.hostname.split(".");
    if (parts.length < 2 || parts[parts.length - 1].length < 2) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Extract the root domain from a URL (e.g. "www.yelp.com/biz/foo" → "yelp.com")
 */
function getRootDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    // For domains like foo.co.uk, keep last 3 parts; otherwise last 2
    const parts = hostname.split(".");
    if (parts.length <= 2) return hostname;
    // Simple heuristic for two-part TLDs
    const twoPartTlds = ["co.uk", "com.au", "co.nz", "co.za", "com.br"];
    const lastTwo = parts.slice(-2).join(".");
    if (twoPartTlds.includes(lastTwo)) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  } catch {
    return null;
  }
}

/**
 * Check if a domain is a blocked platform/directory.
 */
function isBlockedDomain(url: string): boolean {
  const root = getRootDomain(url);
  if (!root) return false;
  return BLOCKED_DOMAINS.has(root);
}

/**
 * Validate a list of raw URL strings for the URL List flow.
 * Returns per-URL validation results so the UI can show warnings.
 */
export function validateUrlList(rawUrls: string): UrlValidationResult[] {
  const lines = rawUrls
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean);

  return lines.map((raw) => {
    const normalized = normalizeUrl(raw);

    if (!normalized) {
      return { url: raw, normalized: null, valid: false, reason: "Not a valid URL or domain" };
    }

    if (isBlockedDomain(normalized)) {
      const root = getRootDomain(normalized);
      return {
        url: raw,
        normalized,
        valid: false,
        reason: `${root} is a directory/platform, not a business website`,
      };
    }

    return { url: raw, normalized, valid: true };
  });
}

async function fetchPageSafe(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TweakAndBuildBot/1.0; +https://tweakandbuild.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractBusinessName(html: string): string | null {
  const $ = cheerio.load(html);
  let title = $("title").first().text().trim();
  if (!title) {
    title =
      $('meta[property="og:site_name"]').attr("content")?.trim() ||
      $('meta[property="og:title"]').attr("content")?.trim() ||
      "";
  }
  if (!title) return null;

  title = title
    .replace(/\s*[|–—-]\s*(home|welcome|official\s*site|main).*$/i, "")
    .replace(/\s*[|–—-]\s*$/, "")
    .trim();

  return title || null;
}

function extractLocation(html: string): { city: string | null; state: string | null } {
  const $ = cheerio.load(html);
  const text = $("body").text();

  const addressRegion =
    $('[itemprop="addressRegion"]').first().text().trim() ||
    $('[property="business:contact_data:region"]').attr("content")?.trim() ||
    null;
  const addressLocality =
    $('[itemprop="addressLocality"]').first().text().trim() ||
    $('[property="business:contact_data:locality"]').attr("content")?.trim() ||
    null;

  if (addressLocality || addressRegion) {
    return { city: addressLocality || null, state: addressRegion || null };
  }

  const snippet = text.slice(0, 2000);
  const match = snippet.match(
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*([A-Z]{2})\b/
  );
  if (match) {
    return { city: match[1], state: match[2] };
  }

  return { city: null, state: null };
}

// ============================================
// Google Places Provider
// ============================================
async function discoverFromGooglePlaces(
  input: DiscoveryInput
): Promise<DiscoveredBusiness[]> {
  const places = await searchGooglePlaces(input);
  const results: DiscoveredBusiness[] = [];

  // Get details for first 20 results (to get phone/website)
  // Batch with concurrency limit of 2
  const detailPromises: Promise<void>[] = [];
  const detailsMap = new Map<string, { phone: string | null; website: string | null }>();

  for (const place of places.slice(0, 20)) {
    const promise = getPlaceDetails(place.google_place_id).then((details) => {
      detailsMap.set(place.google_place_id, {
        phone: details.phone,
        website: details.website,
      });
    });
    detailPromises.push(promise);

    // Process in batches of 2
    if (detailPromises.length >= 2) {
      await Promise.all(detailPromises);
      detailPromises.length = 0;
      await new Promise((resolve) => setTimeout(resolve, 200)); // Rate limit
    }
  }
  if (detailPromises.length > 0) {
    await Promise.all(detailPromises);
  }

  for (const place of places) {
    const details = detailsMap.get(place.google_place_id);
    results.push({
      business_name: place.business_name,
      city: place.city,
      state: place.state,
      website: details?.website ?? place.website,
      phone: details?.phone ?? place.phone,
      source: "google_places",
      niche: input.niche || null,
      google_place_id: place.google_place_id,
      google_rating: place.google_rating,
      google_review_count: place.google_review_count,
      category: place.category,
      address: place.address,
    });
  }

  return results;
}

// ============================================
// Google Custom Search Provider
// ============================================
async function discoverFromGoogleSearch(
  input: DiscoveryInput
): Promise<DiscoveredBusiness[]> {
  const query = buildSearchQuery(
    input.keyword || input.niche || "",
    [input.city, input.state].filter(Boolean).join(" ")
  );

  const searchResults = await searchGoogleCustom(query);
  const results: DiscoveredBusiness[] = [];

  for (const sr of searchResults) {
    try {
      const hostname = new URL(sr.link).hostname.replace(/^www\./, "");
      results.push({
        business_name: sr.title.replace(/\s*[|–—-].*$/, "").trim() || hostname,
        city: input.city || null,
        state: input.state || null,
        website: sr.link,
        phone: null,
        source: "google_search",
        niche: input.niche || null,
        google_place_id: null,
        google_rating: null,
        google_review_count: null,
        category: null,
        address: null,
      });
    } catch {
      // Skip invalid URLs
    }
  }

  return results;
}

// ============================================
// URL List Provider
// ============================================
async function discoverFromUrlList(
  input: DiscoveryInput
): Promise<DiscoveredBusiness[]> {
  const validated = validateUrlList(input.urls ?? "");
  const validUrls = validated
    .filter((v) => v.valid && v.normalized)
    .map((v) => v.normalized!);

  if (validUrls.length === 0) return [];

  const results: DiscoveredBusiness[] = [];

  for (const url of validUrls.slice(0, 50)) {
    const html = await fetchPageSafe(url);
    if (!html) {
      results.push({
        business_name: new URL(url).hostname.replace(/^www\./, ""),
        city: input.city || null,
        state: input.state || null,
        website: url,
        phone: null,
        source: "url_list",
        niche: input.niche || null,
        google_place_id: null,
        google_rating: null,
        google_review_count: null,
        category: null,
        address: null,
      });
      continue;
    }

    const name = extractBusinessName(html);
    const location = extractLocation(html);

    results.push({
      business_name: name || new URL(url).hostname.replace(/^www\./, ""),
      city: location.city || input.city || null,
      state: location.state || input.state || null,
      website: url,
      phone: null,
      source: "url_list",
      niche: input.niche || null,
      google_place_id: null,
      google_rating: null,
      google_review_count: null,
      category: null,
      address: null,
    });
  }

  return results;
}

// ============================================
// Manual Entry Provider
// ============================================
function discoverManual(): DiscoveredBusiness[] {
  return [];
}

// ============================================
// Main Discovery Entry Point
// ============================================
export async function runDiscovery(
  input: DiscoveryInput
): Promise<DiscoveredBusiness[]> {
  switch (input.source) {
    case "google_places":
      return discoverFromGooglePlaces(input);
    case "google_search":
      return discoverFromGoogleSearch(input);
    case "url_list":
      return discoverFromUrlList(input);
    case "manual":
    default:
      return discoverManual();
  }
}
