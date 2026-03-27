import * as cheerio from "cheerio";

export interface PreScoreResult {
  estimated_score: number;
  platform: string | null;
  is_mobile: boolean;
}

const PLATFORM_SIGNALS: Record<string, RegExp[]> = {
  WordPress: [/wp-content/i, /wp-includes/i, /wordpress/i],
  Wix: [/wix\.com/i, /wixsite\.com/i, /_wix_/i],
  Squarespace: [/squarespace\.com/i, /sqsp\.net/i],
  Shopify: [/shopify\.com/i, /cdn\.shopify/i, /myshopify/i],
  Weebly: [/weebly\.com/i],
  GoDaddy: [/godaddy\.com/i, /secureservercdn/i],
  Webflow: [/webflow\.com/i, /webflow\.io/i],
  Joomla: [/joomla/i, /\/media\/system\//i],
  Drupal: [/drupal/i, /sites\/default\/files/i],
};

const REBUILD_PLATFORMS = new Set([
  "WordPress",
  "Wix",
  "Squarespace",
  "Weebly",
  "GoDaddy",
  "Joomla",
  "Drupal",
]);

export async function preScoreDiscoveryResult(
  url: string
): Promise<PreScoreResult> {
  const result: PreScoreResult = {
    estimated_score: 30,
    platform: null,
    is_mobile: true,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const startTime = Date.now();

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

    const loadTime = Date.now() - startTime;

    if (!res.ok) return result;

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return result;

    const html = await res.text();
    const $ = cheerio.load(html);

    // Detect platform
    for (const [platform, patterns] of Object.entries(PLATFORM_SIGNALS)) {
      for (const pattern of patterns) {
        if (pattern.test(html)) {
          result.platform = platform;
          break;
        }
      }
      if (result.platform) break;
    }

    // Check mobile viewport
    const viewport = $('meta[name="viewport"]').attr("content");
    result.is_mobile = !!viewport && viewport.includes("width=device-width");

    // Score calculation
    // +20 if rebuild platform detected
    if (result.platform && REBUILD_PLATFORMS.has(result.platform)) {
      result.estimated_score += 20;
    }

    // +15 if not mobile responsive
    if (!result.is_mobile) {
      result.estimated_score += 15;
    }

    // +10 if slow (>3s)
    if (loadTime > 3000) {
      result.estimated_score += 10;
    }

    // +5 if no SSL (http redirect from https)
    if (!res.url.startsWith("https")) {
      result.estimated_score += 5;
    }

    // Cap at 100
    result.estimated_score = Math.min(result.estimated_score, 100);
  } catch {
    // Return default score on any error
  }

  return result;
}
