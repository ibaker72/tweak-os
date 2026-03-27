import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { executeSmartList } from "@/lib/leads/smart-lists";
import { z } from "zod";

const createSmartListSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().default("list"),
  filters: z.record(z.string(), z.unknown()).default({}),
  sort_by: z.string().default("score"),
  sort_order: z.string().default("desc"),
  is_pinned: z.boolean().default(false),
  color: z.string().optional(),
});

const updateSmartListSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  sort_by: z.string().optional(),
  sort_order: z.string().optional(),
  is_pinned: z.boolean().optional(),
  color: z.string().nullable().optional(),
});

// GET /api/smart-lists — list or execute a smart list
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const execute = searchParams.get("execute");

    if (id && execute === "true") {
      // Execute the smart list and return matching leads
      const { data: smartList, error: fetchError } = await supabase
        .from("smart_lists")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchError) throw fetchError;
      if (!smartList) {
        return NextResponse.json({ error: "Smart list not found" }, { status: 404 });
      }

      const result = await executeSmartList(
        supabase,
        smartList.filters,
        smartList.sort_by,
        smartList.sort_order
      );

      return NextResponse.json({
        smart_list: smartList,
        leads: result.data,
        count: result.count,
      });
    }

    // List all smart lists with counts
    const { data, error } = await supabase
      .from("smart_lists")
      .select("*")
      .order("is_pinned", { ascending: false })
      .order("name");

    if (error) throw error;
    return NextResponse.json({ smart_lists: data ?? [] });
  } catch (err) {
    console.error("Smart lists GET error:", err);
    return NextResponse.json({ error: "Failed to fetch smart lists" }, { status: 500 });
  }
}

// POST /api/smart-lists — create smart list
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const validated = createSmartListSchema.parse(body);

    const { data, error } = await supabase
      .from("smart_lists")
      .insert(validated)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ smart_list: data }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Smart lists POST error:", err);
    return NextResponse.json({ error: "Failed to create smart list" }, { status: 500 });
  }
}

// PATCH /api/smart-lists — update smart list
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, ...updates } = updateSmartListSchema.parse(body);

    const { data, error } = await supabase
      .from("smart_lists")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ smart_list: data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Smart lists PATCH error:", err);
    return NextResponse.json({ error: "Failed to update smart list" }, { status: 500 });
  }
}

// DELETE /api/smart-lists — delete smart list
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id } = z.object({ id: z.string().uuid() }).parse(body);

    const { error } = await supabase
      .from("smart_lists")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Smart lists DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete smart list" }, { status: 500 });
  }
}
