// Keyword → human industry label. Order matters: the FIRST match wins,
// so put more specific tokens (e.g. "hvac") before broader ones.
const INDUSTRY_RULES: Array<{ industry: string; keywords: string[] }> = [
  { industry: "Beauty / Spa", keywords: ["beauty", "salon", "spa", "lashes", "lash", "nails", "nail", "skincare", "skin care", "barber", "hair"] },
  { industry: "HVAC", keywords: ["hvac", "mechanical", "heating", "cooling", "air condition", "refrigeration"] },
  { industry: "Plumbing", keywords: ["plumbing", "plumber"] },
  { industry: "Roofing", keywords: ["roofing", "roofer"] },
  { industry: "Electrical", keywords: ["electric", "electrical", "electrician"] },
  { industry: "Construction", keywords: ["construction", "remodeling", "remodel", "contractor", "builders", "builder", "carpentry", "carpenter", "framing", "drywall"] },
  { industry: "Cleaning", keywords: ["cleaning", "janitorial", "maid"] },
  { industry: "Transportation", keywords: ["trucking", "transport", "logistics", "freight", "shipping", "delivery"] },
  { industry: "Landscaping", keywords: ["landscaping", "landscape", "lawn", "tree", "gardening"] },
  { industry: "Automotive", keywords: ["detailing", "auto", "towing", "tow", "automotive", "mechanic", "tires"] },
  { industry: "Childcare", keywords: ["daycare", "childcare", "preschool", "kids"] },
  { industry: "Fitness", keywords: ["fitness", "gym", "training", "yoga", "pilates", "crossfit"] },
  { industry: "Food / Restaurant", keywords: ["restaurant", "cafe", "kitchen", "food", "pizza", "deli", "bakery", "catering", "grill", "diner"] },
];

// Negative-signal keywords that suggest a holding/investment vehicle
// rather than a service business. Used by the scoring engine.
const HOLDING_KEYWORDS = [
  "holding",
  "holdings",
  "property",
  "properties",
  "investments",
  "investment",
  "capital",
  "ventures",
  "venture",
  "asset",
  "assets",
  "fund",
  "trust",
  "equity",
];

function tokensFor(name: string): string {
  // Lowercase, collapse non-alphanumeric runs to single spaces so we can do
  // word-boundary-style matching with simple `includes(" word ")` checks.
  return ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export function guessIndustryFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const haystack = tokensFor(name);
  for (const rule of INDUSTRY_RULES) {
    for (const kw of rule.keywords) {
      const needle = ` ${kw} `;
      if (haystack.includes(needle)) return rule.industry;
    }
  }
  return null;
}

export function containsHoldingCoKeywords(name: string | null | undefined): boolean {
  if (!name) return false;
  const haystack = tokensFor(name);
  return HOLDING_KEYWORDS.some((kw) => haystack.includes(` ${kw} `));
}
