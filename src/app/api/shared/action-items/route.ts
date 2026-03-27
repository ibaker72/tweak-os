import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface ActionItem {
  id: string;
  label: string;
  href: string;
  priority: "high" | "medium" | "low";
  count: number;
}

// GET /api/shared/action-items — compute cross-module action items
export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const items: ActionItem[] = [];
    const now = new Date();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // 1. Hot leads (score >= 70) not yet contacted
    const { count: hotLeadsCount } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .gte("score", 70)
      .in("lifecycle_status", ["new", "enriched"]);

    if (hotLeadsCount && hotLeadsCount > 0) {
      items.push({
        id: "hot-leads",
        label: `${hotLeadsCount} hot lead${hotLeadsCount !== 1 ? "s" : ""} waiting for outreach`,
        href: "/leads?min_score=70",
        priority: "high",
        count: hotLeadsCount,
      });
    }

    // 2. Leads contacted 3+ days ago with no reply
    const { count: followUpCount } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("lifecycle_status", "contacted")
      .lt("contacted_at", threeDaysAgo.toISOString());

    if (followUpCount && followUpCount > 0) {
      items.push({
        id: "follow-up",
        label: `${followUpCount} lead${followUpCount !== 1 ? "s" : ""} need follow-up`,
        href: "/leads?lifecycle_status=contacted",
        priority: "high",
        count: followUpCount,
      });
    }

    // 3. Drafts stuck in "review" for 3+ days
    const { count: reviewCount } = await supabase
      .from("growth_drafts")
      .select("*", { count: "exact", head: true })
      .eq("status", "review")
      .lt("updated_at", threeDaysAgo.toISOString());

    if (reviewCount && reviewCount > 0) {
      items.push({
        id: "overdue-review",
        label: `${reviewCount} draft${reviewCount !== 1 ? "s" : ""} overdue for review`,
        href: "/growth/pipeline?stage=review",
        priority: "medium",
        count: reviewCount,
      });
    }

    // 4. Drafts stuck in "draft" status for 7+ days
    const { count: staleDraftCount } = await supabase
      .from("growth_drafts")
      .select("*", { count: "exact", head: true })
      .eq("status", "draft")
      .lt("updated_at", sevenDaysAgo.toISOString());

    if (staleDraftCount && staleDraftCount > 0) {
      items.push({
        id: "stale-drafts",
        label: `${staleDraftCount} stale draft${staleDraftCount !== 1 ? "s" : ""} need${staleDraftCount === 1 ? "s" : ""} attention`,
        href: "/growth/drafts",
        priority: "medium",
        count: staleDraftCount,
      });
    }

    // 5. Approved/scheduled drafts ready to publish
    const { count: readyCount } = await supabase
      .from("growth_drafts")
      .select("*", { count: "exact", head: true })
      .in("status", ["approved", "scheduled"]);

    if (readyCount && readyCount > 0) {
      items.push({
        id: "ready-publish",
        label: `${readyCount} article${readyCount !== 1 ? "s" : ""} ready to publish`,
        href: "/growth/publish-queue",
        priority: "low",
        count: readyCount,
      });
    }

    // 6. Pending enrichments (leads with enrichment_status = 'pending' and a website)
    const { count: pendingEnrichCount } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("enrichment_status", "pending")
      .not("website", "is", null);

    if (pendingEnrichCount && pendingEnrichCount > 0) {
      items.push({
        id: "pending-enrich",
        label: `${pendingEnrichCount} lead${pendingEnrichCount !== 1 ? "s" : ""} ready to enrich`,
        href: "/leads?enrichment_status=pending",
        priority: "low",
        count: pendingEnrichCount,
      });
    }

    // 7. Leads with next_action_date that is today or past
    const today = now.toISOString().split("T")[0];
    const { count: nextActionCount } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .lte("next_action_date", today)
      .not("next_action_date", "is", null);

    if (nextActionCount && nextActionCount > 0) {
      items.push({
        id: "overdue-actions",
        label: `${nextActionCount} lead${nextActionCount !== 1 ? "s" : ""} with overdue next actions`,
        href: "/leads/queue",
        priority: "high",
        count: nextActionCount,
      });
    }

    // 8. Outreach sequences scheduled for today
    const { count: dueSequenceCount } = await supabase
      .from("outreach_sequences")
      .select("*", { count: "exact", head: true })
      .gte("scheduled_for", `${today}T00:00:00.000Z`)
      .lte("scheduled_for", `${today}T23:59:59.999Z`)
      .in("status", ["draft", "sent"]);

    if (dueSequenceCount && dueSequenceCount > 0) {
      items.push({
        id: "due-outreach",
        label: `${dueSequenceCount} outreach message${dueSequenceCount !== 1 ? "s" : ""} due today`,
        href: "/leads/queue",
        priority: "high",
        count: dueSequenceCount,
      });
    }

    // 9. Leads assigned with no activity in 5+ days
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const { count: staleAssignedCount } = await supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("assigned_to", "is", null)
      .in("lifecycle_status", ["new", "enriched"])
      .lt("updated_at", fiveDaysAgo.toISOString());

    if (staleAssignedCount && staleAssignedCount > 0) {
      items.push({
        id: "stale-assigned",
        label: `${staleAssignedCount} assigned lead${staleAssignedCount !== 1 ? "s" : ""} with no activity in 5+ days`,
        href: "/leads?lifecycle_status=new",
        priority: "medium",
        count: staleAssignedCount,
      });
    }

    return NextResponse.json({ items });
  } catch (err) {
    console.error("Action items GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch action items" },
      { status: 500 }
    );
  }
}
