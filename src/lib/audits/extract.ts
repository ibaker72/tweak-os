import * as cheerio from "cheerio";
import type { ExtractedSiteData, PageSpeedScores } from "./types";

const FETCH_TIMEOUT_MS = 10_000;
const PAGESPEED_TIMEOUT_MS = 8_000;
const USER_AGENT = "Mozilla/5.0 (compatible; TweakAndBuildAudit/1.0; +https://tweakandbuild.com)";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = FETCH_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...(rest.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

const CONTACT_KEYWORDS = [
  "contact",
  "quote",
  "book",
  "schedule",
  "appointment",
  "get-started",
  "getstarted",
];

export async function extractFromUrl(url: string): Promise<ExtractedSiteData> {
  const normalized = normalizeUrl(url);

  const base: ExtractedSiteData = {
    url: normalized,
    title: null,
    meta_description: null,
    meta_keywords: null,
    h1_tags: [],
    canonical: null,
    og_title: null,
    og_description: null,
    json_ld_types: [],
    has_sitemap: false,
    has_robots_txt: false,
    has_contact_page: false,
    fetch_error: null,
  };

  let html = "";
  try {
    const res = await fetchWithTimeout(normalized);
    if (!res.ok) {
      base.fetch_error = `HTTP ${res.status}`;
    } else {
      html = await res.text();
    }
  } catch (err) {
    base.fetch_error = err instanceof Error ? err.message : "Fetch failed";
  }

  if (html) {
    const $ = cheerio.load(html);
    base.title = ($("title").first().text() || "").trim() || null;
    base.meta_description =
      $('meta[name="description"]').attr("content")?.trim() || null;
    base.meta_keywords =
      $('meta[name="keywords"]').attr("content")?.trim() || null;
    base.canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
    base.og_title = $('meta[property="og:title"]').attr("content")?.trim() || null;
    base.og_description =
      $('meta[property="og:description"]').attr("content")?.trim() || null;

    base.h1_tags = $("h1")
      .slice(0, 3)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0);

    const schemaTypes = new Set<string>();
    $('script[type="application/ld+json"]').each((_, el) => {
      const text = $(el).contents().text();
      if (!text) return;
      try {
        const parsed = JSON.parse(text);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && typeof item === "object") {
            const t = (item as Record<string, unknown>)["@type"];
            if (typeof t === "string") schemaTypes.add(t);
            else if (Array.isArray(t)) {
              for (const v of t) if (typeof v === "string") schemaTypes.add(v);
            }
          }
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    });
    base.json_ld_types = Array.from(schemaTypes);

    $("a[href]").each((_, el) => {
      const href = ($(el).attr("href") || "").toLowerCase();
      if (CONTACT_KEYWORDS.some((kw) => href.includes(kw))) {
        base.has_contact_page = true;
        return false;
      }
    });
  }

  // sitemap + robots HEAD checks (best-effort, don't fail the audit)
  const [sitemap, robots] = await Promise.allSettled([
    headExists(`${stripTrailingSlash(normalized)}/sitemap.xml`),
    headExists(`${stripTrailingSlash(normalized)}/robots.txt`),
  ]);
  if (sitemap.status === "fulfilled") base.has_sitemap = sitemap.value;
  if (robots.status === "fulfilled") base.has_robots_txt = robots.value;

  return base;
}

function stripTrailingSlash(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

async function headExists(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD", timeoutMs: 5_000 });
    return res.ok;
  } catch {
    return false;
  }
}

// TODO: add PAGESPEED_API_KEY env var for higher rate limits.
export async function fetchPageSpeed(url: string): Promise<PageSpeedScores> {
  const empty: PageSpeedScores = {
    performance: null,
    seo: null,
    accessibility: null,
    fcp: null,
    lcp: null,
    cls: null,
    mobile_performance: null,
    desktop_performance: null,
    error: null,
  };

  const apiKey = process.env.PAGESPEED_API_KEY;
  const normalized = normalizeUrl(url);

  function buildUrl(strategy: "mobile" | "desktop"): string {
    const params = new URLSearchParams();
    params.set("url", normalized);
    params.set("strategy", strategy);
    params.append("category", "performance");
    params.append("category", "accessibility");
    params.append("category", "seo");
    if (apiKey) params.set("key", apiKey);
    return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  }

  try {
    const [mobileRes, desktopRes] = await Promise.allSettled([
      fetchWithTimeout(buildUrl("mobile"), { timeoutMs: PAGESPEED_TIMEOUT_MS }),
      fetchWithTimeout(buildUrl("desktop"), { timeoutMs: PAGESPEED_TIMEOUT_MS }),
    ]);

    const mobileJson = await safeJson(mobileRes);
    const desktopJson = await safeJson(desktopRes);

    const mobilePerf = readScore(mobileJson, "performance");
    const desktopPerf = readScore(desktopJson, "performance");
    const seoMobile = readScore(mobileJson, "seo");
    const a11yMobile = readScore(mobileJson, "accessibility");

    empty.mobile_performance = mobilePerf;
    empty.desktop_performance = desktopPerf;
    empty.performance =
      mobilePerf !== null && desktopPerf !== null
        ? Math.round((mobilePerf + desktopPerf) / 2)
        : (mobilePerf ?? desktopPerf);
    empty.seo = seoMobile;
    empty.accessibility = a11yMobile;
    empty.fcp = readAudit(mobileJson, "first-contentful-paint");
    empty.lcp = readAudit(mobileJson, "largest-contentful-paint");
    empty.cls = readAudit(mobileJson, "cumulative-layout-shift");
  } catch (err) {
    empty.error = err instanceof Error ? err.message : "PageSpeed failed";
  }

  return empty;
}

type Settled<T> = PromiseSettledResult<T>;

async function safeJson(settled: Settled<Response>): Promise<unknown> {
  if (settled.status !== "fulfilled") return null;
  try {
    return await settled.value.json();
  } catch {
    return null;
  }
}

function readScore(json: unknown, key: string): number | null {
  if (!json || typeof json !== "object") return null;
  const lhr = (json as Record<string, unknown>)["lighthouseResult"];
  if (!lhr || typeof lhr !== "object") return null;
  const categories = (lhr as Record<string, unknown>)["categories"];
  if (!categories || typeof categories !== "object") return null;
  const cat = (categories as Record<string, unknown>)[key];
  if (!cat || typeof cat !== "object") return null;
  const score = (cat as Record<string, unknown>)["score"];
  if (typeof score !== "number") return null;
  return Math.round(score * 100);
}

function readAudit(json: unknown, key: string): number | null {
  if (!json || typeof json !== "object") return null;
  const lhr = (json as Record<string, unknown>)["lighthouseResult"];
  if (!lhr || typeof lhr !== "object") return null;
  const audits = (lhr as Record<string, unknown>)["audits"];
  if (!audits || typeof audits !== "object") return null;
  const audit = (audits as Record<string, unknown>)[key];
  if (!audit || typeof audit !== "object") return null;
  const value = (audit as Record<string, unknown>)["numericValue"];
  if (typeof value !== "number") return null;
  return value;
}
