import type { EnrichmentResult, InsightResult } from "./types";

/**
 * Rule-based outreach insight generation.
 * Analyzes enrichment data to generate pain points, offer angles,
 * and personalized first lines.
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
    !!enrichment.facebook || !!enrichment.instagram || !!enrichment.linkedin;
  const hasSite = !!lead.website;
  const siteIsLive = !!enrichment.page_title;

  // --- Pain Points ---
  const painPoints = determinePainPoints({
    hasEmail,
    hasPhone,
    hasContactPage,
    hasSocial,
    hasSite,
    siteIsLive,
    niche: lead.niche,
  });

  // --- Offer Angle ---
  const offerAngle = determineOfferAngle({
    hasEmail,
    hasPhone,
    hasContactPage,
    hasSocial,
    hasSite,
    siteIsLive,
    niche: lead.niche,
  });

  // --- First Line ---
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
  niche: string | null;
}

function determinePainPoints(signals: SignalData): [string, string] {
  const points: string[] = [];

  if (!signals.hasSite) {
    points.push(
      "No website presence — potential customers can't find or research the business online."
    );
    points.push(
      "Missing digital storefront means losing leads to competitors with online visibility."
    );
  } else if (!signals.siteIsLive) {
    points.push(
      "Website appears to be down or unreachable — losing credibility with visitors."
    );
    points.push(
      "Broken web presence creates a poor first impression for potential customers."
    );
  } else {
    if (!signals.hasContactPage) {
      points.push(
        "No clear contact page — visitors who want to reach out may give up and leave."
      );
    }
    if (!signals.hasEmail && !signals.hasPhone) {
      points.push(
        "No visible contact info on the website — makes it hard for leads to convert."
      );
    }
    if (!signals.hasSocial) {
      points.push(
        "Missing social media links — limited reach and no social proof for potential customers."
      );
    }
    if (signals.hasEmail && !signals.hasPhone) {
      points.push(
        "Only email listed — some customers prefer calling, which could mean missed opportunities."
      );
    }
    if (signals.hasPhone && !signals.hasEmail) {
      points.push(
        "No email listed — customers who prefer written communication may not reach out."
      );
    }
  }

  // General fallback points
  if (points.length < 2) {
    points.push(
      "May not be capturing all potential leads from website traffic."
    );
  }
  if (points.length < 2) {
    points.push(
      "Could benefit from a more optimized online presence to increase conversions."
    );
  }

  return [points[0], points[1]];
}

function determineOfferAngle(signals: SignalData): string {
  if (!signals.hasSite) {
    return "Help them establish a professional web presence to capture leads they're currently missing.";
  }
  if (!signals.siteIsLive) {
    return "Fix their broken website and restore their online credibility before competitors take their customers.";
  }
  if (!signals.hasContactPage && !signals.hasEmail) {
    return "Add proper contact channels and lead capture to their existing website to convert more visitors.";
  }
  if (!signals.hasSocial) {
    return "Build out their social media presence to complement their website and increase trust signals.";
  }
  if (!signals.hasContactPage) {
    return "Create a dedicated contact/quote page to make it easier for prospects to reach out.";
  }

  return "Optimize their digital presence to improve lead generation and customer acquisition.";
}

function generateFirstLine(
  businessName: string,
  enrichment: EnrichmentResult,
  niche: string | null
): string {
  const name = businessName.trim();

  if (enrichment.page_title && niche) {
    return `Hi — I came across ${name} while looking into ${niche} businesses in the area and had a quick idea that might help bring in more customers.`;
  }

  if (enrichment.page_title) {
    return `Hi — I was browsing ${name}'s website and noticed a few things that could help you get more leads from your online presence.`;
  }

  if (niche) {
    return `Hi — I've been working with ${niche} businesses and thought of something specific that could help ${name} stand out online.`;
  }

  return `Hi — I came across ${name} and had a quick idea for how you could attract more customers through your online presence.`;
}
