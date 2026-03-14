import * as cheerio from "cheerio";
import type { DiscoveryInput } from "./types";

export interface DiscoveredBusiness {
  business_name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  source: string;
  niche: string | null;
}

const FETCH_TIMEOUT = 8_000;

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

/**
 * Extract a likely business name from a page's <title> tag.
 * Strips common suffixes like " | Home", " - Welcome", " – Official Site".
 */
function extractBusinessName(html: string): string | null {
  const $ = cheerio.load(html);
  let title = $("title").first().text().trim();
  if (!title) {
    // Fall back to og:site_name or og:title
    title =
      $('meta[property="og:site_name"]').attr("content")?.trim() ||
      $('meta[property="og:title"]').attr("content")?.trim() ||
      "";
  }
  if (!title) return null;

  // Strip common suffixes
  title = title
    .replace(/\s*[|–—-]\s*(home|welcome|official\s*site|main).*$/i, "")
    .replace(/\s*[|–—-]\s*$/, "")
    .trim();

  return title || null;
}

/**
 * Try to extract city/state from meta tags or structured data.
 */
function extractLocation(html: string): { city: string | null; state: string | null } {
  const $ = cheerio.load(html);
  const text = $("body").text();

  // Look for common address patterns in structured data
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

  // Fall back: look for "City, ST" pattern in first few hundred chars of body
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
// URL List Provider
// ============================================
// User pastes a list of business website URLs.
// We fetch each one and extract business info.
async function discoverFromUrlList(
  input: DiscoveryInput
): Promise<DiscoveredBusiness[]> {
  const urls = (input.urls ?? "")
    .split(/[\n,]+/)
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => (u.startsWith("http") ? u : `https://${u}`));

  if (urls.length === 0) return [];

  const results: DiscoveredBusiness[] = [];

  // Process up to 50 URLs
  for (const url of urls.slice(0, 50)) {
    const html = await fetchPageSafe(url);
    if (!html) {
      // Still record it with just the URL
      results.push({
        business_name: new URL(url).hostname.replace(/^www\./, ""),
        city: input.city || null,
        state: input.state || null,
        website: url,
        source: "url_list",
        niche: input.niche || null,
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
      source: "url_list",
      niche: input.niche || null,
    });
  }

  return results;
}

// ============================================
// Manual Entry Provider
// ============================================
// User fills in niche/city/state/keyword — we create a single
// placeholder result that they can edit before importing.
// This is the simplest "seed" flow.
function discoverManual(input: DiscoveryInput): DiscoveredBusiness[] {
  // Manual mode: user will add results themselves via the UI.
  // We return an empty array; the UI handles manual entry.
  return [];
}

// ============================================
// Yelp Fusion API Provider
// ============================================
// Only works if YELP_API_KEY is configured.
async function discoverFromYelp(
  input: DiscoveryInput
): Promise<DiscoveredBusiness[]> {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Yelp API key not configured. Set YELP_API_KEY in your environment."
    );
  }

  const params = new URLSearchParams();
  if (input.keyword) params.set("term", input.keyword);
  if (input.niche) params.set("categories", input.niche);

  const locationParts = [input.city, input.state].filter(Boolean);
  if (locationParts.length > 0) {
    params.set("location", locationParts.join(", "));
  } else {
    throw new Error("City or state is required for Yelp discovery.");
  }

  params.set("limit", "50");
  params.set("sort_by", "best_match");

  const res = await fetch(
    `https://api.yelp.com/v3/businesses/search?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Yelp API error (${res.status}): ${body}`);
  }

  const data = await res.json();

  return (data.businesses ?? []).map(
    (biz: {
      name: string;
      url: string;
      location?: {
        city?: string;
        state?: string;
      };
    }) => ({
      business_name: biz.name,
      city: biz.location?.city ?? input.city ?? null,
      state: biz.location?.state ?? input.state ?? null,
      website: biz.url ?? null,
      source: "yelp",
      niche: input.niche || null,
    })
  );
}

// ============================================
// Main Discovery Entry Point
// ============================================
export async function runDiscovery(
  input: DiscoveryInput
): Promise<DiscoveredBusiness[]> {
  switch (input.source) {
    case "url_list":
      return discoverFromUrlList(input);
    case "yelp":
      return discoverFromYelp(input);
    case "manual":
    default:
      return discoverManual(input);
  }
}
