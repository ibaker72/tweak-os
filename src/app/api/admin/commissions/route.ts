import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import { getUnpaidBalances } from "@/lib/commissions/balances";
import { openPayoutBatch, setBatchStatus } from "@/lib/commissions/payouts";

/**
 * Admin commission operations: see every agent's balance, open a payout batch,
 * mark one paid.
 *
 * Admin-only throughout. An agent who could open their own batch could decide
 * when they get paid, and one who could mark it paid could close the loop
 * entirely without money moving.
 */

// The period ordering is checked in the handler rather than with .refine(),
// because a refined schema is a ZodEffects and cannot be a member of a
// discriminated union.
const createBatchSchema = z
  .object({
    action: z.literal("create_batch"),
    agent_id: z.string().uuid(),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z.enum(["stripe", "paypal"]).nullable().default(null),
    notes: z.string().max(2000).nullable().default(null),
  })
  .strict();

const markPaidSchema = z
  .object({
    action: z.literal("mark_paid"),
    batch_id: z.string().uuid(),
    // Required: a payout marked paid with no reference to the actual transfer
    // is unverifiable later, which is the whole problem this record exists to
    // prevent.
    external_ref: z.string().min(1).max(200),
    paid_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const setStatusSchema = z
  .object({
    action: z.literal("set_status"),
    batch_id: z.string().uuid(),
    status: z.enum(["pending", "processing", "failed"]),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [
  createBatchSchema,
  markPaidSchema,
  setStatusSchema,
]);

export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  try {
    const [balances, { data: agents }, { data: batches }] = await Promise.all([
      getUnpaidBalances(guard.supabase),
      guard.supabase
        .from("agent_profiles")
        .select(
          "id, display_name, email, role, is_active, partner_type, " +
            "default_commission_rate_bps, inbound_commission_rate_bps, " +
            "payout_method, payout_handle, employment_classification"
        )
        .order("display_name"),
      guard.supabase
        .from("payout_batches")
        .select("id, agent_id, period_start, period_end, total_cents, method, status, paid_at, external_ref, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const byAgent = new Map(balances.map((b) => [b.agentId, b]));

    const rows = (
      (agents ?? []) as unknown as {
        id: string;
        display_name: string;
        is_active: boolean;
        [k: string]: unknown;
      }[]
    ).map((agent) => ({
      ...agent,
      unpaid_cents: byAgent.get(agent.id)?.unpaidCents ?? 0,
      payable_now_cents: byAgent.get(agent.id)?.payableNowCents ?? 0,
    }));

    return NextResponse.json({ agents: rows, batches: batches ?? [] });
  } catch (err) {
    console.error("Admin commissions GET error:", err);
    return NextResponse.json({ error: "Failed to load commissions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  try {
    if (body.action === "create_batch") {
      if (body.period_end < body.period_start) {
        return NextResponse.json(
          { error: "period_end cannot precede period_start" },
          { status: 400 }
        );
      }

      const result = await openPayoutBatch(guard.supabase, {
        agentId: body.agent_id,
        periodStart: body.period_start,
        periodEnd: body.period_end,
        method: body.method,
        notes: body.notes,
      });

      if (result.errors.length > 0) {
        return NextResponse.json({ error: result.errors.join("; ") }, { status: 500 });
      }

      if (result.batchId === null) {
        return NextResponse.json(
          { error: "Nothing payable for that agent — no batch created" },
          { status: 409 }
        );
      }

      await logAdminAction(guard, "commission.batch_created", {
        batch_id: result.batchId,
        agent_id: body.agent_id,
        entries: result.entriesStamped,
        total_cents: result.totalCents,
      });

      return NextResponse.json({ ok: true, ...result }, { status: 201 });
    }

    if (body.action === "mark_paid") {
      const result = await setBatchStatus(guard.supabase, body.batch_id, "paid", {
        externalRef: body.external_ref,
        paidAt: body.paid_at,
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }

      await logAdminAction(guard, "commission.batch_paid", {
        batch_id: body.batch_id,
        external_ref: body.external_ref,
      });

      return NextResponse.json({ ok: true });
    }

    const result = await setBatchStatus(guard.supabase, body.batch_id, body.status);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await logAdminAction(guard, "commission.batch_status_changed", {
      batch_id: body.batch_id,
      status: body.status,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Admin commissions POST error:", err);
    return NextResponse.json({ error: "Operation failed" }, { status: 500 });
  }
}

async function logAdminAction(
  guard: Extract<Awaited<ReturnType<typeof requireAdmin>>, { ok: true }>,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  const { error } = await guard.supabase.from("activity_log").insert({
    module: "platform",
    action,
    entity_type: "payout_batch",
    entity_id: (details.batch_id as string) ?? null,
    details: { ...details, admin_id: guard.agent.id },
  });
  if (error) console.error("Failed to log admin action:", error.message);
}
