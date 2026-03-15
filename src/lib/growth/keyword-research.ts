import type { KeywordOpportunityResult } from "@/types/growth";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY environment variable is not set");
  return key;
}

export async function discoverKeywordOpportunities(
  seed: string
): Promise<KeywordOpportunityResult[]> {
  const apiKey = getOpenAIKey();

  const systemPrompt = `You are an SEO strategist for a premium product engineering studio that builds websites, web apps, e-commerce stores, and automation systems for founders and small businesses. The studio is called Tweak & Build.

Services offered:
- Rapid Build ($2,500-$8K): Quick website builds and rebuilds
- Custom Engineering ($8K-$30K+): Complex web apps, SaaS, custom platforms
- Growth Retainer ($2K-$5K/mo): Ongoing development and optimization
- AI/Automation solutions for business processes

Target clients: Non-technical founders, small business owners, early-stage startups, agencies needing white-label development.`;

  const userPrompt = `Given the seed topic "${seed}", generate 20 keyword opportunities. For each, provide:
- keyword: the exact keyword phrase people would search
- search_demand: estimated monthly search demand relative to common web development queries ("low", "medium", or "high")
- intent: search intent ("informational", "commercial", "transactional", or "navigational")
- difficulty: how hard to rank ("easy", "medium", or "hard")
- relevance_score: 0-100 how relevant this keyword is to Tweak & Build's specific services

Focus on keywords that could drive potential clients to the studio. Mix of:
- Long-tail variations of the seed topic
- Question-based queries ("how much does...", "what is the best...")
- Comparison queries ("X vs Y")
- Commercial intent queries
- Local/service queries

Return ONLY a JSON array, no markdown formatting, no code blocks. Example format:
[{"keyword":"example phrase","search_demand":"medium","intent":"commercial","difficulty":"easy","relevance_score":85}]`;

  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 3000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  try {
    // Strip any markdown code block wrapper if present
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) throw new Error("Expected array");
    return parsed.map((item: Record<string, unknown>) => ({
      keyword: String(item.keyword ?? ""),
      search_demand: (item.search_demand as "low" | "medium" | "high") ?? "low",
      intent: (item.intent as KeywordOpportunityResult["intent"]) ?? "informational",
      difficulty: (item.difficulty as "easy" | "medium" | "hard") ?? "medium",
      relevance_score: Number(item.relevance_score ?? 50),
    }));
  } catch {
    throw new Error("Failed to parse AI keyword suggestions. Raw response: " + content.slice(0, 200));
  }
}

export function calculateOpportunityScore(
  searchDemand: string,
  difficulty: string,
  relevanceScore: number
): number {
  const demandMap: Record<string, number> = { low: 20, medium: 50, high: 90 };
  const difficultyMap: Record<string, number> = { easy: 90, medium: 50, hard: 20 };

  const demand = demandMap[searchDemand] ?? 30;
  const diff = difficultyMap[difficulty] ?? 50;

  // Composite: (demand × (100 - difficulty_penalty) × relevance) / 10000
  return Math.round((demand * diff * relevanceScore) / 10000);
}

export function estimateSearchVolume(searchDemand: string): number {
  const volumeMap: Record<string, number> = {
    low: 100,
    medium: 500,
    high: 2000,
  };
  return volumeMap[searchDemand] ?? 100;
}

export function estimateDifficultyScore(difficulty: string): number {
  const scoreMap: Record<string, number> = {
    easy: 25,
    medium: 55,
    hard: 80,
  };
  return scoreMap[difficulty] ?? 50;
}
