import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";

const createAgentSchema = z.object({
  // The auth.users id for the person being onboarded. Creating the auth user
  // itself needs the Supabase Admin API (service role) and is not done here —
  // an admin invites them in the Supabase dashboard, then links the profile.
  user_id: z.string().uuid(),
  display_name: z.string().min(1).max(120),
  email: z.string().email(),
  role: z.enum(["admin", "agent"]).default("agent"),
  avatar_url: z.string().url().optional(),
});

const updateAgentSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  role: z.enum(["admin", "agent"]).optional(),
  avatar_url: z.string().url().nullable().optional(),
  is_active: z.boolean().optional(),
});

// GET /api/agents — full agent records, admin only.
//
// Agents who just need teammate names read public.agent_directory instead,
// which exposes id/display_name/is_active and nothing else.
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const { data, error } = await guard.supabase
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

// POST /api/agents — link an existing auth user to a new agent profile.
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const parsed = createAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { data, error } = await guard.supabase
      .from("agent_profiles")
      .insert({
        user_id: parsed.data.user_id,
        display_name: parsed.data.display_name,
        email: parsed.data.email,
        role: parsed.data.role,
        avatar_url: parsed.data.avatar_url ?? null,
      })
      .select()
      .single();

    if (error) {
      // agent_profiles has UNIQUE(user_id) and a FK to auth.users.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That user already has an agent profile" },
          { status: 409 }
        );
      }
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "No auth user exists with that user_id" },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ agent: data }, { status: 201 });
  } catch (err) {
    console.error("Agents POST error:", err);
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}

// PATCH /api/agents — update an agent profile (role changes, deactivation).
export async function PATCH(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json();
    const parsed = updateAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { id, ...updates } = parsed.data;

    // An admin demoting or deactivating themselves would lock the last admin
    // out of the app, and nothing else can undo it through the UI.
    if (id === guard.agent.id) {
      if (updates.role === "agent") {
        return NextResponse.json(
          { error: "You cannot remove your own admin role" },
          { status: 400 }
        );
      }
      if (updates.is_active === false) {
        return NextResponse.json(
          { error: "You cannot deactivate your own account" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await guard.supabase
      .from("agent_profiles")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ agent: data });
  } catch (err) {
    console.error("Agents PATCH error:", err);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}
