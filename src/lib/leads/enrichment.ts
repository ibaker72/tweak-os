import type { EnrichmentResult } from "./types";
import {
  extractEmails,
  extractPhones,
  extractPageTitle,
  extractSocialLinks,
  extractContactPageUrl,
  extractInternalPageUrls,
} from "./parsing";

const FETCH_TIMEOUT = 10_000;

async function fetchPage(url: string): Promise<string | null> {
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

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    return await res.text();
  } catch {
    return null;
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
  };

  // Normalize URL
  let url = websiteUrl.trim();
  if (!url.startsWith("http")) {
    url = `https://${url}`;
  }

  // 1. Fetch homepage
  const homepageHtml = await fetchPage(url);
  if (!homepageHtml) return result;

  // 2. Extract from homepage
  result.page_title = extractPageTitle(homepageHtml);
  result.emails.push(...extractEmails(homepageHtml));
  result.phones.push(...extractPhones(homepageHtml));
  const socials = extractSocialLinks(homepageHtml);
  result.facebook = socials.facebook;
  result.instagram = socials.instagram;
  result.linkedin = socials.linkedin;
  result.contact_page = extractContactPageUrl(homepageHtml, url);

  // 3. Try to fetch contact/about page for more data
  const internalUrls = extractInternalPageUrls(homepageHtml, url);
  const contactLikeUrls = internalUrls.filter((u) =>
    /contact|about|team|quote|reach/i.test(u)
  );

  for (const pageUrl of contactLikeUrls.slice(0, 3)) {
    const pageHtml = await fetchPage(pageUrl);
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

    // Update socials if we didn't find them on the homepage
    if (!result.facebook || !result.instagram || !result.linkedin) {
      const pageSocials = extractSocialLinks(pageHtml);
      result.facebook = result.facebook ?? pageSocials.facebook;
      result.instagram = result.instagram ?? pageSocials.instagram;
      result.linkedin = result.linkedin ?? pageSocials.linkedin;
    }
  }

  // Limit results
  result.emails = result.emails.slice(0, 5);
  result.phones = result.phones.slice(0, 5);

  return result;
}
