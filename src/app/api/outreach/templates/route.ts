import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const createTemplateSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["email", "linkedin", "phone", "follow_up"]),
  subject: z.string().optional(),
  body: z.string().min(1),
  variables: z.array(z.string()).default([]),
  sort_order: z.number().default(0),
});

const updateTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  channel: z.enum(["email", "linkedin", "phone", "follow_up"]).optional(),
  subject: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
  variables: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().optional(),
});

// GET /api/outreach/templates — list all templates
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("outreach_templates")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ templates: data ?? [] });
  } catch (err) {
    console.error("Templates GET error:", err);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

// POST /api/outreach/templates — create template
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const validated = createTemplateSchema.parse(body);

    const { data, error } = await supabase
      .from("outreach_templates")
      .insert(validated)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ template: data }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Templates POST error:", err);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}

// PATCH /api/outreach/templates — update template
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id, ...updates } = updateTemplateSchema.parse(body);

    const { data, error } = await supabase
      .from("outreach_templates")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ template: data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Templates PATCH error:", err);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }
}

// DELETE /api/outreach/templates — delete template
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { id } = z.object({ id: z.string().uuid() }).parse(body);

    const { error } = await supabase
      .from("outreach_templates")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Templates DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }
}
