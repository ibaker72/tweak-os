import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import { accrueDeal, sweepClearedPayments } from "@/lib/commissions/accrue";

/**
 * POST /api/commissions/accrue — bring the commission ledger up to date.
 *
 * Admin only: this writes money rows, and an agent who could trigger it
 * against arbitrary deals would be writing their own commission.
 *
 * Safe to call repeatedly. The engine plans only the entries missing from the
 * ledger, and a unique index makes a duplicate earned entry impossible even if
 * this races the nightly cron.
 */

const bodySchema = z
  .object({
    /** Accrue one deal. Omit to sweep. */
    deal_id: z.string().uuid().optional(),
    /** Only consider payments that cleared at or after this instant. */
    since: z.string().datetime({ offset: true }).optional(),
    /** Cap how many payments a sweep pulls in, for a manual partial run. */
    limit: z.number().int().positive().max(5000).optional(),
  })
  .strict();

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const input = parsed.data;

  try {
    const result = input.deal_id
      ? await accrueDeal(guard.supabase, input.deal_id, {
          createdBy: guard.agent.id,
        })
      : await sweepClearedPayments(guard.supabase, {
          since: input.since ?? null,
          createdBy: guard.agent.id,
          limit: input.limit,
        });

    // Skips are the normal case, not a failure — a capped retainer month and
    // an uncleared payment both land here, and both are worth surfacing.
    return NextResponse.json(
      {
        deals_examined: result.dealsExamined,
        entries_written: result.entriesWritten,
        cents_written: result.centsWritten,
        duplicates_ignored: result.duplicatesIgnored,
        skipped: result.skipped,
        errors: result.errors,
      },
      { status: result.errors.length > 0 ? 207 : 200 }
    );
  } catch (err) {
    console.error("Commission accrual error:", err);
    return NextResponse.json({ error: "Accrual failed" }, { status: 500 });
  }
}
