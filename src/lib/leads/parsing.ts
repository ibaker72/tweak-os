import * as cheerio from "cheerio";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

export function extractEmails(html: string): string[] {
  const matches = html.match(EMAIL_REGEX) ?? [];
  const unique = [...new Set(matches.map((e) => e.toLowerCase()))];
  // Filter out common false positives
  return unique.filter(
    (e) =>
      !e.endsWith(".png") &&
      !e.endsWith(".jpg") &&
      !e.endsWith(".gif") &&
      !e.endsWith(".svg") &&
      !e.includes("example.com") &&
      !e.includes("sentry.io") &&
      !e.includes("wixpress.com") &&
      !e.includes("webpack")
  );
}

export function extractPhones(html: string): string[] {
  const $ = cheerio.load(html);
  // Get text content to reduce false positives from scripts
  const text = $("body").text();
  const matches = text.match(PHONE_REGEX) ?? [];
  const normalized = matches.map((p) => p.replace(/[^\d+]/g, ""));
  // Filter out numbers that are too short or look like zip codes
  return [...new Set(normalized)].filter((p) => p.length >= 10).slice(0, 5);
}

export function extractPageTitle(html: string): string | null {
  const $ = cheerio.load(html);
  const title = $("title").first().text().trim();
  return title || null;
}

export function extractSocialLinks(html: string): {
  facebook: string | null;
  instagram: string | null;
  linkedin: string | null;
} {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    links.push($(el).attr("href") ?? "");
  });

  return {
    facebook:
      links.find(
        (l) =>
          l.includes("facebook.com/") &&
          !l.includes("facebook.com/sharer")
      ) ?? null,
    instagram:
      links.find(
        (l) =>
          l.includes("instagram.com/") &&
          !l.includes("instagram.com/p/")
      ) ?? null,
    linkedin:
      links.find(
        (l) =>
          l.includes("linkedin.com/") &&
          !l.includes("linkedin.com/share")
      ) ?? null,
  };
}

export function extractContactPageUrl(
  html: string,
  baseUrl: string
): string | null {
  const $ = cheerio.load(html);
  const contactPatterns = [
    /contact/i,
    /get.?in.?touch/i,
    /reach.?us/i,
    /about/i,
    /quote/i,
    /request/i,
  ];

  let contactHref: string | null = null;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().trim();
    for (const pattern of contactPatterns) {
      if (pattern.test(href) || pattern.test(text)) {
        contactHref = href;
        return false; // break
      }
    }
  });

  if (!contactHref) return null;

  try {
    return new URL(contactHref, baseUrl).toString();
  } catch {
    return contactHref;
  }
}

export function extractInternalPageUrls(
  html: string,
  baseUrl: string
): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const urls: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname === base.hostname && resolved.pathname !== "/") {
        urls.push(resolved.toString());
      }
    } catch {
      // skip invalid URLs
    }
  });

  return [...new Set(urls)].slice(0, 10);
}
