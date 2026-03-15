import type { EnrichmentResult, InsightResult } from "./types";

/**
 * Rule-based outreach insight generation.
 * Used as a fallback when OpenAI is not available.
 */
export function generateInsights(
  enrichment: EnrichmentResult,
  lead: {
    business_name: string;
    niche: string | null;
    website: string | null;
  }
): InsightResult {
  const hasEmail = enrichment.emails.length > 0;
  const hasPhone = enrichment.phones.length > 0;
  const hasContactPage = !!enrichment.contact_page;
  const hasSocial =
    !!enrichment.facebook || !!enrichment.instagram || !!enrichment.linkedin || !!enrichment.twitter;
  const hasSite = !!lead.website;
  const siteIsLive = !!enrichment.page_title;
  const hasRebuildPlatform = enrichment.tech_stack.some((t) =>
    ["Wix", "Squarespace", "WordPress", "GoDaddy", "Webflow"].some((p) =>
      t.toLowerCase().includes(p.toLowerCase())
    )
  );
  const isSlow = (enrichment.page_load_time_ms ?? 0) > 3000;
  const notMobile = !enrichment.is_mobile_responsive;

  const painPoints = determinePainPoints({
    hasEmail,
    hasPhone,
    hasContactPage,
    hasSocial,
    hasSite,
    siteIsLive,
    hasRebuildPlatform,
    isSlow,
    notMobile,
    techStack: enrichment.tech_stack,
    loadTime: enrichment.page_load_time_ms,
    niche: lead.niche,
  });

  const offerAngle = determineOfferAngle({
    hasRebuildPlatform,
    isSlow,
    notMobile,
    hasSite,
    siteIsLive,
    hasContactPage,
    hasEmail,
    hasSocial,
    techStack: enrichment.tech_stack,
    hasEcommerce: enrichment.has_ecommerce,
  });

  const suggestedFirstLine = generateFirstLine(
    lead.business_name,
    enrichment,
    lead.niche
  );

  return {
    pain_point_1: painPoints[0],
    pain_point_2: painPoints[1],
    offer_angle: offerAngle,
    suggested_first_line: suggestedFirstLine,
  };
}

interface SignalData {
  hasEmail: boolean;
  hasPhone: boolean;
  hasContactPage: boolean;
  hasSocial: boolean;
  hasSite: boolean;
  siteIsLive: boolean;
  hasRebuildPlatform: boolean;
  isSlow: boolean;
  notMobile: boolean;
  techStack: string[];
  loadTime: number | null;
  niche: string | null;
}

function determinePainPoints(signals: SignalData): [string, string] {
  const points: string[] = [];

  if (!signals.hasSite) {
    points.push("No website presence — potential customers can't find or research the business online.");
    points.push("Missing digital storefront means losing leads to competitors with online visibility.");
  } else if (!signals.siteIsLive) {
    points.push("Website appears to be down or unreachable — losing credibility with visitors.");
    points.push("Broken web presence creates a poor first impression for potential customers.");
  } else {
    if (signals.hasRebuildPlatform) {
      const platform = signals.techStack.find((t) =>
        ["Wix", "Squarespace", "WordPress", "GoDaddy", "Webflow"].some((p) =>
          t.toLowerCase().includes(p.toLowerCase())
        )
      );
      points.push(
        `Built on ${platform} — limited customization, slower performance, and harder to scale as the business grows.`
      );
    }
    if (signals.isSlow) {
      points.push(
        `Website loads in ${((signals.loadTime ?? 3000) / 1000).toFixed(1)}s — every second of delay loses ~7% of conversions.`
      );
    }
    if (signals.notMobile) {
      points.push("Website is not mobile responsive — losing over 60% of potential traffic in 2026.");
    }
    if (!signals.hasContactPage) {
      points.push("No clear contact page — visitors who want to reach out may give up and leave.");
    }
    if (!signals.hasEmail && !signals.hasPhone) {
      points.push("No visible contact info on the website — makes it hard for leads to convert.");
    }
    if (!signals.hasSocial) {
      points.push("Missing social media links — limited reach and no social proof for potential customers.");
    }
  }

  if (points.length < 2) {
    points.push("May not be capturing all potential leads from website traffic.");
  }
  if (points.length < 2) {
    points.push("Could benefit from a more optimized online presence to increase conversions.");
  }

  return [points[0], points[1]];
}

interface OfferSignals {
  hasRebuildPlatform: boolean;
  isSlow: boolean;
  notMobile: boolean;
  hasSite: boolean;
  siteIsLive: boolean;
  hasContactPage: boolean;
  hasEmail: boolean;
  hasSocial: boolean;
  techStack: string[];
  hasEcommerce: boolean;
}

function determineOfferAngle(signals: OfferSignals): string {
  if (!signals.hasSite) {
    return "Rapid Build ($2,500-$8K) — build a professional website from scratch to establish their online presence and start capturing leads.";
  }
  if (!signals.siteIsLive) {
    return "Rapid Build ($2,500-$8K) — fix and relaunch their website to restore online credibility before competitors take their customers.";
  }
  if (signals.hasRebuildPlatform && signals.hasEcommerce) {
    return "Custom Engineering ($8K-$30K+) — rebuild their e-commerce platform with a custom solution for better performance, SEO, and conversion rates.";
  }
  if (signals.hasRebuildPlatform) {
    return "Rapid Build ($2,500-$8K) — migrate from their current platform to a custom, fast, mobile-friendly website that converts better.";
  }
  if (signals.isSlow || signals.notMobile) {
    return "Rapid Build ($2,500-$8K) — optimize their website for speed and mobile responsiveness to stop losing potential customers.";
  }
  return "Growth Retainer ($2K-$5K/mo) — ongoing optimization and feature development to improve their digital presence and lead generation.";
}

function generateFirstLine(
  businessName: string,
  enrichment: EnrichmentResult,
  niche: string | null
): string {
  const name = businessName.trim();
  const platform = enrichment.tech_stack.find((t) =>
    ["Wix", "Squarespace", "WordPress", "GoDaddy", "Webflow"].some((p) =>
      t.toLowerCase().includes(p.toLowerCase())
    )
  );

  if (platform && enrichment.page_load_time_ms && enrichment.page_load_time_ms > 3000) {
    return `Hi — I noticed ${name}'s ${platform} site takes ${(enrichment.page_load_time_ms / 1000).toFixed(1)}s to load. We helped a similar business cut their load time by 80% and saw a 3x increase in leads.`;
  }

  if (platform) {
    return `Hi — I came across ${name} and noticed your site is on ${platform}. We've helped businesses like yours migrate to custom platforms and typically see 2-3x better conversion rates.`;
  }

  if (!enrichment.is_mobile_responsive) {
    return `Hi — I was looking at ${name}'s website and noticed it isn't optimized for mobile. With over 60% of web traffic coming from phones, this could be costing you significant business.`;
  }

  if (enrichment.page_title && niche) {
    return `Hi — I came across ${name} while researching ${niche} businesses and noticed a few quick wins that could help drive more customers to your door.`;
  }

  return `Hi — I came across ${name} and had a specific idea for how you could attract more customers through your online presence.`;
}
