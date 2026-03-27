import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const createAgentSchema = z.object({
  display_name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "agent"]).default("agent"),
  avatar_url: z.string().optional(),
});

const updateAgentSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(["admin", "agent"]).optional(),
  avatar_url: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
});

// GET /api/agents — list all agents
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("agent_profiles")
      .select("*")
      .order("display_name");

    if (error) throw error;
    return NextResponse.json({ agents: data ?? [] });
  } catch (err) {
    console.error("Agents GET error:", err);
    return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 });
  }
}

// POST /api/agents — create agent
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Check current user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("agent_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profile && profile.role !== "admin") {
      return NextResponse.json({ error: "Only admins can create agents" }, { status: 403 });
    }

    const body = await request.json();
    const validated = createAgentSchema.parse(body);

    // For now, create agent profile linked to current user if no user_id provided
    const { data, error } = await supabase
      .from("agent_profiles")
      .insert({
        user_id: user.id,
        display_name: validated.display_name,
        email: validated.email,
        role: validated.role,
        avatar_url: validated.avatar_url ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ agent: data }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Agents POST error:", err);
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}

// PATCH /api/agents — update agent
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("agent_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profile && profile.role !== "admin") {
      return NextResponse.json({ error: "Only admins can update agents" }, { status: 403 });
    }

    const body = await request.json();
    const { id, ...updates } = updateAgentSchema.parse(body);

    const { data, error } = await supabase
      .from("agent_profiles")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ agent: data });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Agents PATCH error:", err);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}
