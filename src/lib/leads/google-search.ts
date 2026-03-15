export interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
}

export async function searchGoogleCustom(
  query: string
): Promise<GoogleSearchResult[]> {
  const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_CUSTOM_SEARCH_CX;

  if (!apiKey || !cx) {
    throw new Error(
      "GOOGLE_CUSTOM_SEARCH_API_KEY and GOOGLE_CUSTOM_SEARCH_CX environment variables are required"
    );
  }

  const params = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
    num: "10",
  });

  const res = await fetch(
    `https://www.googleapis.com/customsearch/v1?${params.toString()}`
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Custom Search API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.items ?? []).map(
    (item: { title: string; link: string; snippet: string }) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
    })
  );
}

export function buildSearchQuery(industry: string, city: string): string {
  return `${industry} ${city} site:.com`;
}
