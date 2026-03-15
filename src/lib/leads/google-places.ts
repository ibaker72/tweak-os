import type { DiscoveryInput } from "./types";

export interface GooglePlaceResult {
  business_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  website: string | null;
  google_place_id: string;
  google_rating: number | null;
  google_review_count: number | null;
  category: string | null;
  hours: string | null;
  source: "google_places";
  niche: string | null;
}

const GOOGLE_PLACES_BASE = "https://maps.googleapis.com/maps/api/place";

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_PLACES_API_KEY environment variable is not set");
  }
  return key;
}

export async function searchGooglePlaces(
  input: DiscoveryInput
): Promise<GooglePlaceResult[]> {
  const apiKey = getApiKey();
  const results: GooglePlaceResult[] = [];

  // Build text search query
  const queryParts = [input.keyword, input.niche, input.city, input.state].filter(Boolean);
  const query = queryParts.join(" ");

  if (!query.trim()) {
    throw new Error("At least one of keyword, niche, city, or state is required for Google Places search");
  }

  // Use Text Search for broader queries
  const params = new URLSearchParams({
    query,
    key: apiKey,
  });

  if (input.radius) {
    params.set("radius", String(input.radius * 1609)); // miles to meters
  }

  const url = `${GOOGLE_PLACES_BASE}/textsearch/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google Places API error: ${res.status}`);
  }

  const data = await res.json();

  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places API status: ${data.status} - ${data.error_message || ""}`);
  }

  for (const place of data.results ?? []) {
    const addressComponents = parseFormattedAddress(place.formatted_address);

    results.push({
      business_name: place.name,
      address: place.formatted_address ?? null,
      city: addressComponents.city || input.city || null,
      state: addressComponents.state || input.state || null,
      zip: addressComponents.zip || null,
      phone: null, // Text Search doesn't include phone — need Place Details
      website: null, // Same — need Place Details
      google_place_id: place.place_id,
      google_rating: place.rating ?? null,
      google_review_count: place.user_ratings_total ?? null,
      category: place.types?.[0] ?? null,
      hours: place.opening_hours?.open_now !== undefined
        ? (place.opening_hours.open_now ? "Open now" : "Closed")
        : null,
      source: "google_places",
      niche: input.niche || null,
    });
  }

  // Handle next_page_token for more results (up to 60 total)
  if (data.next_page_token && results.length < 60) {
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Google requires delay
    const nextParams = new URLSearchParams({
      pagetoken: data.next_page_token,
      key: apiKey,
    });
    const nextUrl = `${GOOGLE_PLACES_BASE}/textsearch/json?${nextParams.toString()}`;
    const nextRes = await fetch(nextUrl);
    if (nextRes.ok) {
      const nextData = await nextRes.json();
      for (const place of nextData.results ?? []) {
        const addressComponents = parseFormattedAddress(place.formatted_address);
        results.push({
          business_name: place.name,
          address: place.formatted_address ?? null,
          city: addressComponents.city || input.city || null,
          state: addressComponents.state || input.state || null,
          zip: addressComponents.zip || null,
          phone: null,
          website: null,
          google_place_id: place.place_id,
          google_rating: place.rating ?? null,
          google_review_count: place.user_ratings_total ?? null,
          category: place.types?.[0] ?? null,
          hours: null,
          source: "google_places",
          niche: input.niche || null,
        });
      }
    }
  }

  return results;
}

export async function getPlaceDetails(
  placeId: string
): Promise<{ phone: string | null; website: string | null; hours: string[] }> {
  const apiKey = getApiKey();
  const params = new URLSearchParams({
    place_id: placeId,
    fields: "formatted_phone_number,website,opening_hours",
    key: apiKey,
  });

  const url = `${GOOGLE_PLACES_BASE}/details/json?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { phone: null, website: null, hours: [] };
  }

  const data = await res.json();
  const result = data.result ?? {};

  return {
    phone: result.formatted_phone_number ?? null,
    website: result.website ?? null,
    hours: result.opening_hours?.weekday_text ?? [],
  };
}

function parseFormattedAddress(address: string | undefined): {
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  if (!address) return { city: null, state: null, zip: null };

  // Typical format: "123 Main St, City, ST 12345, USA"
  const parts = address.split(",").map((p) => p.trim());

  let city: string | null = null;
  let state: string | null = null;
  let zip: string | null = null;

  if (parts.length >= 3) {
    city = parts[parts.length - 3] || null;
    const stateZip = parts[parts.length - 2] || "";
    const match = stateZip.match(/^([A-Z]{2})\s*(\d{5}(?:-\d{4})?)?$/);
    if (match) {
      state = match[1];
      zip = match[2] || null;
    }
  } else if (parts.length === 2) {
    city = parts[0] || null;
    const match = parts[1].match(/^([A-Z]{2})\s*(\d{5})?/);
    if (match) {
      state = match[1];
      zip = match[2] || null;
    }
  }

  return { city, state, zip };
}
