import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";

/**
 * GET /api/my/queue — the agent's own work queue.
 *
 * There is no `assigned_to = me` filter here, deliberately. RLS scopes `leads`
 * to the caller's assigned rows, so this returns their queue because the
 * database says so, not because this file remembered to add a WHERE clause.
 * An admin calling it sees everything, which is the correct read of "my queue"
 * for someone who owns the whole pipeline.
 */

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  // Lifecycle stages that are still workable.
  include_done: z.coerce.boolean().default(false),
});

const WORKABLE = ["new", "enriched", "contacted", "replied", "meeting_booked"];

const LEAD_COLUMNS =
  "id, business_name, website, phone, email, city, state, niche, score, priority, " +
  "lifecycle_status, next_action, next_action_date, contacted_at, assigned_to, updated_at";

export async function GET(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: searchParams.get("limit") ?? undefined,
    include_done: searchParams.get("include_done") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    let query = guard.supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .is("archived_at", null)
      .is("deleted_at", null)
      // Sort order is the brief's: next_action_date first, then score.
      // nullsFirst: false puts undated leads after the scheduled ones, which
      // is what "work your calendar, then work the list" means in practice.
      .order("next_action_date", { ascending: true, nullsFirst: false })
      .order("score", { ascending: false })
      .limit(parsed.data.limit);

    if (!parsed.data.include_done) {
      query = query.in("lifecycle_status", WORKABLE);
    }

    const { data, error } = await query;
    if (error) throw error;

    const today = new Date().toISOString().slice(0, 10);
    const leads = (data ?? []) as unknown as {
      id: string;
      next_action_date: string | null;
    }[];

    return NextResponse.json({
      leads,
      counts: {
        total: leads.length,
        overdue: leads.filter(
          (l) => l.next_action_date !== null && String(l.next_action_date) < today
        ).length,
        today: leads.filter((l) => String(l.next_action_date) === today).length,
        unscheduled: leads.filter((l) => l.next_action_date === null).length,
      },
    });
  } catch (err) {
    console.error("Queue GET error:", err);
    return NextResponse.json({ error: "Failed to load queue" }, { status: 500 });
  }
}
