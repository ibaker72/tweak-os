import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import {
  inviteAgentSchema,
  resolveInviteRedirectUrl,
  resolveOrInviteAuthUser,
} from "@/lib/auth/agent-onboarding";
import {
  AdminAuthUnavailableError,
  getAdminAuth,
  type AdminAuthApi,
} from "@/lib/supabase/admin-auth";

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

// POST /api/agents — onboard a teammate from a name and an email.
//
// Two writes in two systems: a login in auth.users (Admin API, service role)
// and the authorisation row in public.agent_profiles (the caller's own
// session, subject to agent_profiles_admin_all). They are done in that order
// because only the second one can be retried into a correct end state — see
// the partial-failure branch at the bottom.
//
// The client no longer supplies a user_id. It used to be required, which is
// why the Add button did nothing: the browser has no way to know an auth.users
// id, so every submission failed validation and the UI threw the response
// away. The id is now derived from the email, server-side.
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = inviteAgentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { display_name, email } = parsed.data;

  // Annotated rather than inferred so the real SDK type is checked against
  // the narrow port resolveOrInviteAuthUser accepts.
  let adminAuth: AdminAuthApi;
  try {
    adminAuth = getAdminAuth();
  } catch (err) {
    if (err instanceof AdminAuthUnavailableError) {
      console.error("Agents POST: admin auth unavailable");
      return NextResponse.json(
        {
          error:
            "Invitations are not configured on this server. Set SUPABASE_SERVICE_ROLE_KEY and try again.",
        },
        { status: 503 }
      );
    }
    throw err;
  }

  const resolved = await resolveOrInviteAuthUser(adminAuth, {
    email,
    displayName: display_name,
    redirectTo: resolveInviteRedirectUrl(),
  });

  if (!resolved.ok) {
    // The detail is GoTrue's own wording. It goes to the server log, never to
    // the browser.
    console.error(`Agents POST: ${resolved.code}:`, resolved.detail);

    if (resolved.code === "existing_user_unresolvable") {
      return NextResponse.json(
        {
          error:
            "That email already has a login, but it could not be matched automatically. Link it from the Supabase dashboard.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Could not send the invitation. Try again." },
      { status: 502 }
    );
  }

  const { userId, invited } = resolved;

  try {
    // Checked before inserting so the common conflict answers with a sentence
    // rather than a constraint violation. It is not the protection — a second
    // request that gets here at the same moment is caught by UNIQUE(user_id)
    // below — it is the readable half of it.
    const { data: existing } = await guard.supabase
      .from("agent_profiles")
      .select("id, display_name, email")
      .eq("user_id", userId)
      .maybeSingle<{ id: string; display_name: string; email: string }>();

    if (existing) {
      return NextResponse.json(
        {
          error: `That user already has an agent profile (${existing.display_name}).`,
          code: "profile_exists",
        },
        { status: 409 }
      );
    }

    const { data, error } = await guard.supabase
      .from("agent_profiles")
      .insert({
        user_id: userId,
        display_name,
        email,
        // Never taken from the request. A new teammate is an agent; promoting
        // one is a separate PATCH an admin has to mean.
        role: "agent",
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      // UNIQUE(user_id): the double-click, or two admins onboarding the same
      // person at once. One row exists, which is the desired end state.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "That user already has an agent profile.", code: "profile_exists" },
          { status: 409 }
        );
      }
      // FK to auth.users. Only reachable if the user was deleted between the
      // invite and this insert.
      if (error.code === "23503") {
        return NextResponse.json(
          { error: "That login no longer exists. Try again." },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json(
      { agent: data, outcome: invited ? "invited" : "linked" },
      { status: 201 }
    );
  } catch (err) {
    console.error("Agents POST error:", err);

    // The invite landed but the profile did not. The auth user is deliberately
    // left in place: deleting it would destroy an account the invitee may have
    // already accepted, and the next attempt resolves it by lookup and links
    // the profile that is missing. Saying so is what makes the retry obvious.
    return NextResponse.json(
      {
        error: invited
          ? `${email} was invited, but their agent profile could not be created. Press Invite Agent again to finish linking them.`
          : "Could not create the agent profile. Try again.",
        invite_sent: invited,
      },
      { status: 500 }
    );
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
