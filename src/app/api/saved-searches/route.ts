import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createSavedSearch,
  deleteSavedSearch,
  updateSavedSearchLastRun,
} from "@/lib/leads/mutations";
import { getSavedSearches } from "@/lib/leads/queries";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(1),
  query: z.string().min(1),
  location: z.string().optional(),
  radius: z.number().optional(),
  industry: z.string().optional(),
  is_recurring: z.boolean().optional(),
});

// GET /api/saved-searches
export async function GET() {
  try {
    const supabase = await createClient();
    const searches = await getSavedSearches(supabase);
    return NextResponse.json({ searches });
  } catch (err) {
    console.error("Get saved searches error:", err);
    return NextResponse.json(
      { error: "Failed to get saved searches" },
      { status: 500 }
    );
  }
}

// POST /api/saved-searches — create a saved search
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const data = createSchema.parse(body);

    const id = await createSavedSearch(supabase, data);

    return NextResponse.json({ success: true, id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: err.issues },
        { status: 400 }
      );
    }
    console.error("Create saved search error:", err);
    return NextResponse.json(
      { error: "Failed to create saved search" },
      { status: 500 }
    );
  }
}

// DELETE /api/saved-searches
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    await deleteSavedSearch(supabase, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete saved search error:", err);
    return NextResponse.json(
      { error: "Failed to delete saved search" },
      { status: 500 }
    );
  }
}
