import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { sweepClearedPayments } from "@/lib/commissions/accrue";

/**
 * GET /api/cron/commissions/accrue — nightly sweep of newly cleared payments.
 *
 * Invoked by Vercel Cron (see vercel.json), which sends
 * `Authorization: Bearer $CRON_SECRET` and carries no user session. Like the
 * Twilio webhook, this route authenticates on a shared secret rather than a
 * cookie, which is why it is exempt from the session gate in proxy.ts.
 *
 * It uses the service-role client for the same reason: there is no user to act
 * as. That is the only other place in the app allowed to, and
 * src/lib/auth/route-coverage.test.ts fails the build if it spreads further.
 *
 * The sweep is idempotent, so a retried or overlapping run cannot double-pay.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

/** How far back each nightly run looks. Generous overlap is free here. */
const LOOKBACK_DAYS = 7;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  // Compare in constant time. Length is checked first because
  // timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    // Deliberately terse: this endpoint should reveal nothing about whether
    // CRON_SECRET is configured.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);

  try {
    const supabase = createServiceClient();
    const result = await sweepClearedPayments(supabase, {
      since: since.toISOString(),
      createdBy: null,
    });

    if (result.errors.length > 0) {
      console.error("Nightly accrual finished with errors:", result.errors);
    }

    const capped = result.skipped.filter(
      (s) => s.reason === "recurring_cap_reached"
    );
    if (capped.length > 0) {
      // Rule 5: when the cap stops an accrual, say so somewhere durable.
      console.info(
        `Nightly accrual: ${capped.length} payment(s) hit a recurring cap`,
        capped
      );
    }

    return NextResponse.json({
      swept_since: since.toISOString(),
      deals_examined: result.dealsExamined,
      entries_written: result.entriesWritten,
      cents_written: result.centsWritten,
      duplicates_ignored: result.duplicatesIgnored,
      skipped_count: result.skipped.length,
      capped_count: capped.length,
      errors: result.errors,
    });
  } catch (err) {
    console.error("Nightly accrual failed:", err);
    return NextResponse.json({ error: "Accrual failed" }, { status: 500 });
  }
}
