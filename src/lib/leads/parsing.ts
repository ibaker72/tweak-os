import * as cheerio from "cheerio";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

export function extractEmails(html: string): string[] {
  const matches = html.match(EMAIL_REGEX) ?? [];
  const unique = [...new Set(matches.map((e) => e.toLowerCase()))];
  return unique.filter(
    (e) =>
      !e.endsWith(".png") &&
      !e.endsWith(".jpg") &&
      !e.endsWith(".gif") &&
      !e.endsWith(".svg") &&
      !e.endsWith(".webp") &&
      !e.includes("example.com") &&
      !e.includes("sentry.io") &&
      !e.includes("wixpress.com") &&
      !e.includes("webpack") &&
      !e.includes("cloudflare") &&
      !e.includes("googleapis") &&
      !e.includes("schema.org")
  );
}

export function extractPhones(html: string): string[] {
  const $ = cheerio.load(html);
  const text = $("body").text();
  const matches = text.match(PHONE_REGEX) ?? [];

  // Also check mailto: and tel: links
  const telLinks: string[] = [];
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const phone = href.replace("tel:", "").trim();
    if (phone) telLinks.push(phone);
  });

  const allPhones = [...matches, ...telLinks];
  const normalized = allPhones.map((p) => {
    const digits = p.replace(/[^\d+]/g, "");
    // Normalize to E.164 format for US numbers
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return digits;
  });

  return [...new Set(normalized)].filter((p) => p.length >= 11).slice(0, 5);
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

export function extractTwitter(html: string): string | null {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    links.push($(el).attr("href") ?? "");
  });

  return (
    links.find(
      (l) =>
        (l.includes("twitter.com/") || l.includes("x.com/")) &&
        !l.includes("/intent/") &&
        !l.includes("/share")
    ) ?? null
  );
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

export function extractTechStack(html: string): string[] {
  const stack: string[] = [];
  const lower = html.toLowerCase();

  // Check meta generator tag
  const $ = cheerio.load(html);
  const generator = $('meta[name="generator"]').attr("content")?.toLowerCase() ?? "";

  // WordPress
  if (
    generator.includes("wordpress") ||
    lower.includes("wp-content") ||
    lower.includes("wp-includes")
  ) {
    stack.push("WordPress");
  }

  // Wix
  if (lower.includes("wix.com") || lower.includes("wixsite.com") || generator.includes("wix")) {
    stack.push("Wix");
  }

  // Squarespace
  if (lower.includes("squarespace") || generator.includes("squarespace")) {
    stack.push("Squarespace");
  }

  // Shopify
  if (lower.includes("cdn.shopify.com") || lower.includes("shopify")) {
    stack.push("Shopify");
  }

  // Next.js
  if (lower.includes("__next") || lower.includes("_next/static")) {
    stack.push("Next.js");
  }

  // React (check after Next.js since Next uses React)
  if (
    !stack.includes("Next.js") &&
    (lower.includes("react") || lower.includes("__react"))
  ) {
    stack.push("React");
  }

  // Vue.js
  if (lower.includes("__vue") || lower.includes("vue.js") || lower.includes("nuxt")) {
    stack.push("Vue.js");
  }

  // Angular
  if (lower.includes("ng-app") || lower.includes("angular")) {
    stack.push("Angular");
  }

  // Webflow
  if (lower.includes("webflow.com") || lower.includes("w-nav")) {
    stack.push("Webflow");
  }

  // GoDaddy Website Builder
  if (lower.includes("godaddy.com") || lower.includes("website-builder")) {
    stack.push("GoDaddy");
  }

  // jQuery
  if (lower.includes("jquery")) {
    stack.push("jQuery");
  }

  // Bootstrap
  if (lower.includes("bootstrap")) {
    stack.push("Bootstrap");
  }

  // Google Tag Manager
  if (lower.includes("googletagmanager.com")) {
    stack.push("Google Tag Manager");
  }

  // Google Analytics
  if (lower.includes("google-analytics.com") || lower.includes("gtag")) {
    stack.push("Google Analytics");
  }

  // Facebook Pixel
  if (lower.includes("connect.facebook.net") || lower.includes("fbevents.js")) {
    stack.push("Facebook Pixel");
  }

  return [...new Set(stack)];
}

export function checkMobileResponsive(html: string): boolean {
  const $ = cheerio.load(html);

  // Check viewport meta tag
  const viewport = $('meta[name="viewport"]').attr("content") ?? "";
  if (viewport.includes("width=device-width")) {
    return true;
  }

  // Check for responsive CSS frameworks
  const lower = html.toLowerCase();
  if (
    lower.includes("bootstrap") ||
    lower.includes("tailwind") ||
    lower.includes("@media")
  ) {
    return true;
  }

  return false;
}

export function checkHasBlog(html: string, baseUrl: string): boolean {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().toLowerCase();
    links.push(href.toLowerCase());
    if (text.includes("blog") || text.includes("news") || text.includes("articles")) {
      links.push("blog-found");
    }
  });

  return links.some(
    (l) =>
      l === "blog-found" ||
      l.includes("/blog") ||
      l.includes("/news") ||
      l.includes("/articles") ||
      l.includes("/posts")
  );
}

export function checkHasEcommerce(html: string): boolean {
  const lower = html.toLowerCase();

  return (
    lower.includes("add to cart") ||
    lower.includes("add-to-cart") ||
    lower.includes("shopping-cart") ||
    lower.includes("checkout") ||
    lower.includes("shopify") ||
    lower.includes("woocommerce") ||
    lower.includes("bigcommerce") ||
    lower.includes("/shop") ||
    lower.includes("/store") ||
    lower.includes("/products") ||
    lower.includes("product-price") ||
    lower.includes("buy now")
  );
}
