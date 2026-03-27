import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assignLeadsToAgent, autoAssignRoundRobin } from "@/lib/leads/assignment";
import { logActivity } from "@/lib/leads/mutations";
import { z } from "zod";

const assignSchema = z.union([
  z.object({
    lead_ids: z.array(z.string().uuid()).min(1),
    agent_id: z.string().uuid(),
  }),
  z.object({
    lead_ids: z.array(z.string().uuid()).min(1),
    strategy: z.literal("round_robin"),
  }),
]);

// POST /api/leads/assign — assign leads to agent(s)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const input = assignSchema.parse(body);

    if ("agent_id" in input) {
      await assignLeadsToAgent(supabase, input.lead_ids, input.agent_id);

      // Log activity for each lead
      for (const leadId of input.lead_ids) {
        await logActivity(supabase, leadId, "assigned", {
          agent_id: input.agent_id,
        });
      }

      return NextResponse.json({
        success: true,
        assigned: input.lead_ids.length,
        agent_id: input.agent_id,
      });
    } else {
      const result = await autoAssignRoundRobin(supabase, input.lead_ids);

      // Log activity
      for (const [agentId, ids] of Object.entries(result.assignments)) {
        for (const leadId of ids) {
          await logActivity(supabase, leadId, "auto_assigned", {
            agent_id: agentId,
            strategy: "round_robin",
          });
        }
      }

      return NextResponse.json({
        success: true,
        assignments: result.assignments,
      });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: err.issues }, { status: 400 });
    }
    console.error("Assign error:", err);
    return NextResponse.json({ error: "Assignment failed" }, { status: 500 });
  }
}
