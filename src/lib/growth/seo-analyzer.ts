import type { SeoFeedback } from "@/types/growth";

interface SeoCheckInput {
  title: string;
  content: string;
  meta_title: string | null;
  meta_description: string | null;
  target_keyword: string;
  slug: string | null;
}

export function analyzeSeo(input: SeoCheckInput): { score: number; feedback: SeoFeedback } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;
  const kw = input.target_keyword.toLowerCase();
  const contentLower = input.content.toLowerCase();
  const titleLower = input.title.toLowerCase();
  const words = input.content.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Title includes keyword
  if (!titleLower.includes(kw)) {
    issues.push("Title does not contain the target keyword");
    score -= 15;
  }

  // Meta title exists
  if (!input.meta_title || input.meta_title.trim().length === 0) {
    issues.push("Meta title is missing");
    score -= 10;
  } else if (input.meta_title.length > 60) {
    suggestions.push(`Meta title is ${input.meta_title.length} chars (recommended: under 60)`);
    score -= 5;
  }

  // Meta description exists
  if (!input.meta_description || input.meta_description.trim().length === 0) {
    issues.push("Meta description is missing");
    score -= 10;
  } else if (input.meta_description.length > 160) {
    suggestions.push(`Meta description is ${input.meta_description.length} chars (recommended: under 160)`);
    score -= 5;
  } else if (!input.meta_description.toLowerCase().includes(kw.split(" ")[0])) {
    suggestions.push("Meta description should include the target keyword");
    score -= 5;
  }

  // H2s present
  const h2Count = (input.content.match(/^## /gm) || []).length;
  if (h2Count === 0) {
    issues.push("No H2 headings found in content");
    score -= 15;
  } else if (h2Count < 3) {
    suggestions.push(`Only ${h2Count} H2 heading(s) — consider adding more structure`);
    score -= 5;
  }

  // Keyword in H2s
  const h2Lines = input.content.split("\n").filter((l) => l.startsWith("## "));
  const h2WithKeyword = h2Lines.filter((l) => l.toLowerCase().includes(kw.split(" ")[0]));
  if (h2WithKeyword.length === 0 && h2Lines.length > 0) {
    suggestions.push("None of the H2 headings reference the target keyword");
    score -= 5;
  }

  // Content length
  if (wordCount < 500) {
    issues.push(`Content is only ${wordCount} words — too short for SEO`);
    score -= 20;
  } else if (wordCount < 1000) {
    suggestions.push(`Content is ${wordCount} words — aim for 1,500+ for best ranking potential`);
    score -= 5;
  }

  // Keyword density
  const keywordOccurrences = (contentLower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  const density = wordCount > 0 ? (keywordOccurrences / wordCount) * 100 : 0;
  if (keywordOccurrences === 0) {
    issues.push("Target keyword not found in content body");
    score -= 15;
  } else if (density > 3) {
    suggestions.push(`Keyword density is ${density.toFixed(1)}% — may feel over-optimized (aim for 1-2%)`);
    score -= 5;
  } else if (keywordOccurrences < 3) {
    suggestions.push("Target keyword appears less than 3 times — consider adding a few more mentions");
    score -= 5;
  }

  // Internal links
  const internalLinks = (input.content.match(/tweakandbuild\.com/g) || []).length;
  if (internalLinks === 0) {
    issues.push("No internal links to tweakandbuild.com found");
    score -= 10;
  }

  // CTA present
  const hasCta =
    contentLower.includes("contact") ||
    contentLower.includes("get in touch") ||
    contentLower.includes("reach out") ||
    contentLower.includes("schedule a call") ||
    contentLower.includes("book a call");
  if (!hasCta) {
    suggestions.push("No clear call-to-action found — add a CTA directing readers to take action");
    score -= 5;
  }

  // Slug check
  if (input.slug) {
    if (!input.slug.includes(kw.split(" ")[0])) {
      suggestions.push("URL slug should include the primary keyword");
      score -= 5;
    }
  } else {
    suggestions.push("Set a URL slug for this content");
    score -= 5;
  }

  // First paragraph includes keyword
  const firstParagraph = input.content.split("\n").find((l) => l.trim().length > 30 && !l.startsWith("#"));
  if (firstParagraph && !firstParagraph.toLowerCase().includes(kw.split(" ")[0])) {
    suggestions.push("Include the target keyword in the first paragraph");
    score -= 5;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    feedback: { issues, suggestions },
  };
}

export function estimateReadability(content: string): number {
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = content.trim().split(/\s+/).filter(Boolean);
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);

  if (sentences.length === 0 || words.length === 0) return 50;

  // Flesch Reading Ease (simplified)
  const avgSentenceLength = words.length / sentences.length;
  const avgSyllablesPerWord = syllables / words.length;
  const score = 206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const matches = w.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 1;
  if (w.endsWith("e") && !w.endsWith("le")) count--;
  return Math.max(1, count);
}
