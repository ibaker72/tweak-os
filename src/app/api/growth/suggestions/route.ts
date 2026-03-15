import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/growth/suggestions — cross-module content suggestions based on lead data
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    // Analyze leads for common tech stacks
    const { data: techData } = await supabase
      .from("leads")
      .select("tech_stack")
      .not("tech_stack", "is", null);

    // Analyze leads for common industries/niches
    const { data: nicheData } = await supabase
      .from("leads")
      .select("niche")
      .not("niche", "is", null);

    // Count tech stacks
    const techCounts: Record<string, number> = {};
    for (const row of (techData ?? []) as { tech_stack: string[] }[]) {
      if (Array.isArray(row.tech_stack)) {
        for (const tech of row.tech_stack) {
          techCounts[tech] = (techCounts[tech] || 0) + 1;
        }
      }
    }

    // Count niches
    const nicheCounts: Record<string, number> = {};
    for (const row of (nicheData ?? []) as { niche: string }[]) {
      if (row.niche) {
        nicheCounts[row.niche] = (nicheCounts[row.niche] || 0) + 1;
      }
    }

    const suggestions: {
      type: string;
      title: string;
      description: string;
      keyword: string;
    }[] = [];

    // Generate tech-stack based suggestions
    const topTech = Object.entries(techCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [tech, count] of topTech) {
      const techLower = tech.toLowerCase();

      if (
        techLower.includes("wix") ||
        techLower.includes("squarespace") ||
        techLower.includes("weebly") ||
        techLower.includes("godaddy")
      ) {
        suggestions.push({
          type: "migration",
          title: `High lead volume on ${tech} — consider publishing about ${tech} migration`,
          description: `${count} leads are using ${tech}. Write content about migrating from ${tech} to a custom-built solution to capture this audience.`,
          keyword: `${tech.toLowerCase()} migration custom website`,
        });
      }

      if (techLower.includes("wordpress")) {
        suggestions.push({
          type: "comparison",
          title: `${count} leads on WordPress — publish comparison content`,
          description: `Many leads use WordPress. Create content comparing WordPress limitations vs custom development for growing businesses.`,
          keyword: `wordpress vs custom website development`,
        });
      }

      if (techLower.includes("shopify")) {
        suggestions.push({
          type: "guide",
          title: `Shopify users detected — write about scaling beyond Shopify`,
          description: `${count} leads use Shopify. Publish guides about when to move from Shopify to a custom e-commerce solution.`,
          keyword: `shopify limitations custom ecommerce`,
        });
      }
    }

    // Generate niche-based suggestions
    const topNiches = Object.entries(nicheCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [niche, count] of topNiches) {
      suggestions.push({
        type: "industry",
        title: `${count} leads in ${niche} — create industry-specific content`,
        description: `You have ${count} leads in the ${niche} industry. Publish content targeting "${niche} website" or "${niche} digital transformation" to attract more leads in this vertical.`,
        keyword: `${niche.toLowerCase()} website development`,
      });
    }

    // If no data, provide default suggestions
    if (suggestions.length === 0) {
      suggestions.push(
        {
          type: "general",
          title: "Start by discovering keyword opportunities",
          description:
            "No lead data available yet for cross-module suggestions. Use the opportunities tool to discover keywords based on your target market.",
          keyword: "custom website development for small business",
        },
        {
          type: "general",
          title: "Write about common founder pain points",
          description:
            "Create content addressing questions founders commonly ask when looking for a web development partner.",
          keyword: "how to hire a web developer",
        }
      );
    }

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("Suggestions GET error:", err);
    return NextResponse.json(
      { error: "Failed to generate suggestions" },
      { status: 500 }
    );
  }
}
