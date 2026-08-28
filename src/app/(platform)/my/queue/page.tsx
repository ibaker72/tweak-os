import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { QueueClient, type QueueLead } from "./QueueClient";

/**
 * /my/queue — the screen an agent lives in.
 *
 * Rendered on the server so the first paint already has the queue; the client
 * component takes over for keyboard navigation and optimistic actions.
 *
 * There is no `assigned_to = me` filter. RLS scopes `leads` to the caller's
 * assigned rows, so this query returns their queue because the database says
 * so — not because this file remembered a WHERE clause.
 */

const WORKABLE = ["new", "enriched", "contacted", "replied", "meeting_booked"];

export default async function MyQueuePage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("leads")
    .select(
      "id, business_name, website, phone, email, city, state, niche, score, priority, " +
        "lifecycle_status, next_action, next_action_date, contacted_at"
    )
    .is("archived_at", null)
    .is("deleted_at", null)
    .in("lifecycle_status", WORKABLE)
    // The brief's order: work the calendar first, then work the list.
    .order("next_action_date", { ascending: true, nullsFirst: false })
    .order("score", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-5">
      <DashboardHeader
        title="My Queue"
        description="Your assigned leads, soonest action first."
      />
      <QueueClient initialLeads={(data ?? []) as unknown as QueueLead[]} />
    </div>
  );
}
