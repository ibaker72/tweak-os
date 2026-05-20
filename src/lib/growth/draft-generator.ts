import type { GrowthBrief } from "@/types/growth";
import { generateCompletion } from "@/lib/ai/anthropic";

export async function generateDraft(brief: GrowthBrief): Promise<string> {
  const outlineText = brief.outline?.sections
    ?.map((s) => {
      const prefix = s.level === "h2" ? "##" : "###";
      const points = s.key_points.map((p) => `  - ${p}`).join("\n");
      return `${prefix} ${s.heading}\n${points}`;
    })
    .join("\n\n") ?? "No outline provided.";

  const systemPrompt = `You are a content writer for Tweak & Build, a premium product engineering studio that builds websites, web apps, e-commerce stores, and automation systems. Write in a confident, practical, no-BS tone. Avoid filler, generic advice, and corporate speak. Include specific examples, real numbers where possible, and actionable takeaways. Format in markdown with proper H2/H3 structure.`;

  const userPrompt = `Write a complete blog post following this brief exactly.

Title: ${brief.title}
Target Keyword: ${brief.target_keyword}
Secondary Keywords: ${brief.secondary_keywords?.join(", ") || "None"}
Target Word Count: ${brief.target_word_count}
Target Audience: ${brief.target_audience || "Founders and small business owners"}
CTA Strategy: ${brief.cta_strategy || "Direct readers to tweakandbuild.com/contact"}

Outline:
${outlineText}

Internal links to include: ${brief.internal_links?.join(", ") || "tweakandbuild.com/contact"}

Requirements:
- Follow the outline structure exactly
- Use the target keyword naturally in the intro, at least 2 H2s, and the conclusion
- Include specific examples, numbers, and actionable advice
- Write ${brief.target_word_count} words minimum
- End with a clear CTA directing readers to tweakandbuild.com/contact
- Use markdown formatting (## for H2, ### for H3, **bold** for emphasis, - for lists)
- Do NOT include a title/H1 — that's handled separately`;

  return generateCompletion({
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 4000,
  });
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function generateMetaTitle(title: string, keyword: string): string {
  if (title.toLowerCase().includes(keyword.toLowerCase())) {
    return title.length <= 60 ? title : title.slice(0, 57) + "...";
  }
  const withKeyword = `${title} | ${keyword}`;
  return withKeyword.length <= 60 ? withKeyword : title.slice(0, 57) + "...";
}

export function generateMetaDescription(content: string, keyword: string): string {
  const paragraphs = content
    .split("\n")
    .filter((line) => !line.startsWith("#") && line.trim().length > 50);

  const relevant = paragraphs.find((p) =>
    p.toLowerCase().includes(keyword.toLowerCase().split(" ")[0])
  ) ?? paragraphs[0] ?? "";

  const cleaned = relevant.replace(/\*\*/g, "").replace(/\[.*?\]\(.*?\)/g, "").trim();
  return cleaned.length <= 155 ? cleaned : cleaned.slice(0, 152) + "...";
}
