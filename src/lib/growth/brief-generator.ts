import type { GeneratedBrief } from "@/types/growth";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY environment variable is not set");
  return key;
}

export async function generateBrief(keyword: string): Promise<GeneratedBrief> {
  const apiKey = getOpenAIKey();

  const systemPrompt = `You are a content strategist for Tweak & Build, a premium product engineering studio. You create detailed content briefs that help write SEO-optimized articles targeting founders and small business owners considering hiring a web development studio.

The studio's website is tweakandbuild.com. Key pages to link to:
- tweakandbuild.com/contact (main CTA)
- tweakandbuild.com/services
- tweakandbuild.com/work (portfolio)
- tweakandbuild.com/about`;

  const userPrompt = `Create a content brief for the keyword "${keyword}" targeting founders and small business owners considering hiring a web development studio.

Return ONLY a JSON object (no markdown, no code blocks) with this exact structure:
{
  "title_options": ["Title Option 1", "Title Option 2", "Title Option 3"],
  "target_url": "/blog/suggested-slug",
  "outline": {
    "sections": [
      {
        "heading": "Section Title",
        "level": "h2",
        "key_points": ["Point 1", "Point 2", "Point 3"]
      }
    ]
  },
  "target_word_count": 1500,
  "internal_links": ["https://tweakandbuild.com/contact", "https://tweakandbuild.com/services"],
  "cta_strategy": "Description of what action we want readers to take",
  "competitor_angle": "How to differentiate from competitor content on this topic"
}

Include 5-7 H2 sections in the outline, each with 2-4 key points. Make the outline detailed enough that a writer can follow it exactly.`;

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
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  try {
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      title_options: parsed.title_options ?? [keyword],
      target_url: parsed.target_url ?? `/blog/${keyword.toLowerCase().replace(/\s+/g, "-")}`,
      outline: parsed.outline ?? { sections: [] },
      target_word_count: parsed.target_word_count ?? 1500,
      internal_links: parsed.internal_links ?? [],
      cta_strategy: parsed.cta_strategy ?? "",
      competitor_angle: parsed.competitor_angle ?? "",
    };
  } catch {
    throw new Error("Failed to parse brief. Raw: " + content.slice(0, 200));
  }
}
