import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { getAgentBalance } from "@/lib/commissions/balances";
import {
  buildCommissionCsv,
  commissionCsvFilename,
  type LedgerCsvRow,
} from "@/lib/agent/commission-csv";

/**
 * GET /api/my/commissions — the agent's ledger, plus ?format=csv.
 *
 * On straight commission this is the agent's entire compensation record, so
 * every row carries the basis and the rate that produced it. Nothing is
 * rounded or re-derived here: the amounts are the ledger's own integers.
 *
 * RLS scopes commission_entries to the caller's own rows.
 */

const querySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});

const ENTRY_COLUMNS =
  "id, created_at, entry_type, amount_cents, rate_bps_applied, basis_cents, " +
  "memo, payable_at, payout_batch_id, deal_id";

export async function GET(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    format: searchParams.get("format") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const supabase = guard.supabase;

    const { data: entries, error } = await supabase
      .from("commission_entries")
      .select(ENTRY_COLUMNS)
      .eq("agent_id", guard.agent.id)
      .order("created_at", { ascending: false })
      .limit(parsed.data.limit);

    if (error) throw error;

    const rows = (entries ?? []) as unknown as {
      id: string;
      created_at: string;
      entry_type: string;
      amount_cents: number;
      rate_bps_applied: number | null;
      basis_cents: number | null;
      memo: string | null;
      payable_at: string;
      payout_batch_id: string | null;
      deal_id: string;
    }[];

    // Deal and account names, and batch status, so a row reads without having
    // to cross-reference anything else.
    const [{ data: deals }, { data: accounts }, { data: batches }, balance] =
      await Promise.all([
        supabase.from("deals").select("id, name, account_id"),
        supabase.from("accounts").select("id, company_name"),
        supabase.from("payout_batches").select("id, status, paid_at"),
        getAgentBalance(supabase, guard.agent.id),
      ]);

    const dealMap = new Map(
      ((deals ?? []) as { id: string; name: string; account_id: string }[]).map((d) => [
        d.id,
        d,
      ])
    );
    const accountMap = new Map(
      ((accounts ?? []) as { id: string; company_name: string }[]).map((a) => [
        a.id,
        a.company_name,
      ])
    );
    const batchMap = new Map(
      (
        (batches ?? []) as { id: string; status: string; paid_at: string | null }[]
      ).map((b) => [b.id, b])
    );

    const csvRows: LedgerCsvRow[] = rows.map((row) => {
      const deal = dealMap.get(row.deal_id);
      const batch = row.payout_batch_id ? batchMap.get(row.payout_batch_id) : null;
      return {
        created_at: row.created_at,
        entry_type: row.entry_type,
        deal_name: deal?.name ?? null,
        account_name: deal ? (accountMap.get(deal.account_id) ?? null) : null,
        basis_cents: row.basis_cents,
        rate_bps_applied: row.rate_bps_applied,
        amount_cents: row.amount_cents,
        payable_at: row.payable_at,
        payout_batch_id: row.payout_batch_id,
        batch_status: batch?.status ?? null,
        batch_paid_at: batch?.paid_at ?? null,
        memo: row.memo,
      };
    });

    if (parsed.data.format === "csv") {
      const csv = buildCommissionCsv(csvRows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          // BOM so Excel opens UTF-8 correctly rather than mangling names.
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${commissionCsvFilename(
            guard.agent.display_name
          )}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json({
      balance,
      entries: csvRows.map((row, i) => ({ ...row, id: rows[i].id })),
    });
  } catch (err) {
    console.error("Commissions GET error:", err);
    return NextResponse.json({ error: "Failed to load commissions" }, { status: 500 });
  }
}
