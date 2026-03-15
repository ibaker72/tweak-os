import type { EnrichmentResult } from "./types";
import {
  extractEmails,
  extractPhones,
  extractPageTitle,
  extractSocialLinks,
  extractContactPageUrl,
  extractInternalPageUrls,
  extractTechStack,
  checkMobileResponsive,
  checkHasBlog,
  checkHasEcommerce,
  extractTwitter,
} from "./parsing";

const FETCH_TIMEOUT = 10_000;
const CRAWL_DELAY = 1000; // 1 second between requests to same domain

async function fetchPage(
  url: string
): Promise<{ html: string | null; loadTimeMs: number | null; hasSsl: boolean }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const start = Date.now();

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
    const loadTimeMs = Date.now() - start;

    if (!res.ok) return { html: null, loadTimeMs: null, hasSsl: false };

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html"))
      return { html: null, loadTimeMs: null, hasSsl: false };

    const html = await res.text();
    const hasSsl = res.url.startsWith("https://");

    return { html, loadTimeMs, hasSsl };
  } catch {
    return { html: null, loadTimeMs: null, hasSsl: false };
  }
}

async function checkRobotsTxt(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL("/robots.txt", baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "TweakAndBuildBot/1.0",
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return true; // No robots.txt = allowed

    const text = await res.text();
    // Simple check: if robots.txt disallows our bot or all bots from /
    const lines = text.split("\n");
    let appliesToUs = false;
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith("user-agent:")) {
        const agent = trimmed.replace("user-agent:", "").trim();
        appliesToUs = agent === "*" || agent.includes("tweakandbuild");
      }
      if (appliesToUs && trimmed === "disallow: /") {
        return false; // Blocked
      }
    }
    return true;
  } catch {
    return true; // On error, assume allowed
  }
}

export async function enrichWebsite(
  websiteUrl: string
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {
    page_title: null,
    emails: [],
    phones: [],
    contact_page: null,
    facebook: null,
    instagram: null,
    linkedin: null,
    twitter: null,
    tech_stack: [],
    has_ssl: false,
    is_mobile_responsive: false,
    has_blog: false,
    has_ecommerce: false,
    page_load_time_ms: null,
    last_modified: null,
  };

  // Normalize URL
  let url = websiteUrl.trim();
  if (!url.startsWith("http")) {
    url = `https://${url}`;
  }

  // Check robots.txt
  const allowed = await checkRobotsTxt(url);
  if (!allowed) {
    // Still return basic result — just don't crawl deep
    const { html, loadTimeMs, hasSsl } = await fetchPage(url);
    if (html) {
      result.page_title = extractPageTitle(html);
      result.has_ssl = hasSsl;
      result.page_load_time_ms = loadTimeMs;
    }
    return result;
  }

  // 1. Fetch homepage
  const { html: homepageHtml, loadTimeMs, hasSsl } = await fetchPage(url);
  if (!homepageHtml) return result;

  result.has_ssl = hasSsl;
  result.page_load_time_ms = loadTimeMs;

  // 2. Extract from homepage
  result.page_title = extractPageTitle(homepageHtml);
  result.emails.push(...extractEmails(homepageHtml));
  result.phones.push(...extractPhones(homepageHtml));

  const socials = extractSocialLinks(homepageHtml);
  result.facebook = socials.facebook;
  result.instagram = socials.instagram;
  result.linkedin = socials.linkedin;
  result.twitter = extractTwitter(homepageHtml);
  result.contact_page = extractContactPageUrl(homepageHtml, url);

  // Tech stack detection
  result.tech_stack = extractTechStack(homepageHtml);

  // Mobile responsive check
  result.is_mobile_responsive = checkMobileResponsive(homepageHtml);

  // Blog detection
  result.has_blog = checkHasBlog(homepageHtml, url);

  // E-commerce detection
  result.has_ecommerce = checkHasEcommerce(homepageHtml);

  // 3. Crawl contact/about pages for more data
  const internalUrls = extractInternalPageUrls(homepageHtml, url);
  const contactLikeUrls = internalUrls.filter((u) =>
    /contact|about|team|quote|reach/i.test(u)
  );

  for (const pageUrl of contactLikeUrls.slice(0, 3)) {
    await new Promise((resolve) => setTimeout(resolve, CRAWL_DELAY));

    const { html: pageHtml } = await fetchPage(pageUrl);
    if (!pageHtml) continue;

    const moreEmails = extractEmails(pageHtml);
    const morePhones = extractPhones(pageHtml);

    for (const email of moreEmails) {
      if (!result.emails.includes(email)) {
        result.emails.push(email);
      }
    }
    for (const phone of morePhones) {
      if (!result.phones.includes(phone)) {
        result.phones.push(phone);
      }
    }

    // Update socials if not found on homepage
    if (!result.facebook || !result.instagram || !result.linkedin || !result.twitter) {
      const pageSocials = extractSocialLinks(pageHtml);
      result.facebook = result.facebook ?? pageSocials.facebook;
      result.instagram = result.instagram ?? pageSocials.instagram;
      result.linkedin = result.linkedin ?? pageSocials.linkedin;
      if (!result.twitter) {
        result.twitter = extractTwitter(pageHtml);
      }
    }
  }

  // Limit results
  result.emails = result.emails.slice(0, 5);
  result.phones = result.phones.slice(0, 5);

  return result;
}
