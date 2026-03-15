import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/growth/calendar — get calendar entries
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    // Fetch calendar entries
    let calendarQuery = supabase
      .from("growth_calendar")
      .select("*")
      .order("scheduled_date", { ascending: true });

    if (startDate) {
      calendarQuery = calendarQuery.gte("scheduled_date", startDate);
    }
    if (endDate) {
      calendarQuery = calendarQuery.lte("scheduled_date", endDate);
    }

    const { data: calendarEntries, error: calendarError } = await calendarQuery;
    if (calendarError) throw calendarError;

    // Fetch scheduled drafts
    let draftsQuery = supabase
      .from("growth_drafts")
      .select("id, title, scheduled_for, status")
      .not("scheduled_for", "is", null);

    if (startDate) {
      draftsQuery = draftsQuery.gte("scheduled_for", startDate);
    }
    if (endDate) {
      draftsQuery = draftsQuery.lte("scheduled_for", endDate);
    }

    const { data: scheduledDrafts, error: draftsError } = await draftsQuery;
    if (draftsError) throw draftsError;

    // Merge scheduled drafts into entries format
    const draftEntries = (scheduledDrafts ?? []).map(
      (draft: { id: string; title: string; scheduled_for: string; status: string }) => ({
        id: `draft-${draft.id}`,
        draft_id: draft.id,
        title: draft.title,
        scheduled_date: draft.scheduled_for,
        content_type: "blog_post",
        status: draft.status,
        notes: null,
        created_at: null,
        user_id: null,
      })
    );

    const entries = [...(calendarEntries ?? []), ...draftEntries].sort(
      (a, b) =>
        new Date(a.scheduled_date).getTime() - new Date(b.scheduled_date).getTime()
    );

    return NextResponse.json({ entries });
  } catch (err) {
    console.error("Calendar GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch calendar entries" },
      { status: 500 }
    );
  }
}

// POST /api/growth/calendar — add calendar entry
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { draft_id, title, scheduled_date, content_type, notes } = body;

    if (!title || !scheduled_date) {
      return NextResponse.json(
        { error: "title and scheduled_date are required" },
        { status: 400 }
      );
    }

    const { data: entry, error } = await supabase
      .from("growth_calendar")
      .insert({
        draft_id: draft_id ?? null,
        title,
        scheduled_date,
        content_type: content_type ?? null,
        notes: notes ?? null,
        status: "planned",
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ entry });
  } catch (err) {
    console.error("Calendar POST error:", err);
    return NextResponse.json(
      { error: "Failed to create calendar entry" },
      { status: 500 }
    );
  }
}

// PATCH /api/growth/calendar — update calendar entry
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, scheduled_date, notes, status } = body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (scheduled_date !== undefined) updates.scheduled_date = scheduled_date;
    if (notes !== undefined) updates.notes = notes;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data: entry, error } = await supabase
      .from("growth_calendar")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ entry });
  } catch (err) {
    console.error("Calendar PATCH error:", err);
    return NextResponse.json(
      { error: "Failed to update calendar entry" },
      { status: 500 }
    );
  }
}
