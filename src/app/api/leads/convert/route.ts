import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";

/**
 * POST /api/leads/convert — turn a lead into an account plus a draft deal.
 *
 * The work happens inside public.convert_lead_to_account(), a SECURITY DEFINER
 * function. Agents have SELECT-only on accounts and deals and keep it that
 * way: if they could INSERT a deal directly they could write their own
 * commission_rate_bps. The function reads the rate from the owning agent's
 * profile server-side, so it is never client-supplied — note there is no rate
 * field in the schema below, and that absence is the point.
 *
 * The deal is created as `draft`. An admin reviews the contract value and
 * signs it; until then it contributes no expected commission.
 */

const bodySchema = z
  .object({
    lead_id: z.string().uuid(),
    company_name: z.string().min(1).max(200),
    deal_name: z.string().min(1).max(200),
    deal_type: z.enum(["rapid_build", "custom_engineering", "growth_retainer"]),
    commission_model: z.enum(["one_time", "recurring"]),
    contract_value_cents: z.number().int().min(0).max(1_000_000_000).default(0),
    mrr_cents: z.number().int().min(0).max(100_000_000).default(0),
    recurring_cap_months: z.number().int().positive().max(120).nullable().default(null),
    primary_contact_name: z.string().max(200).nullable().default(null),
    primary_contact_email: z.string().email().max(320).nullable().default(null),
    primary_contact_phone: z.string().max(50).nullable().default(null),
  })
  .strict()
  .refine(
    (v) => v.commission_model !== "recurring" || v.mrr_cents > 0,
    { message: "A recurring deal needs an mrr_cents above zero", path: ["mrr_cents"] }
  )
  .refine(
    (v) => v.commission_model !== "one_time" || v.recurring_cap_months === null,
    {
      message: "A one-time deal cannot have a recurring cap",
      path: ["recurring_cap_months"],
    }
  );

export async function POST(request: NextRequest) {
  const guard = await requireUser();
  if (!guard.ok) return guard.response;

  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data;

  try {
    const { data, error } = await guard.supabase.rpc("convert_lead_to_account", {
      p_lead_id: input.lead_id,
      p_company_name: input.company_name,
      p_deal_name: input.deal_name,
      p_deal_type: input.deal_type,
      p_commission_model: input.commission_model,
      p_contract_value_cents: input.contract_value_cents,
      p_mrr_cents: input.mrr_cents,
      p_recurring_cap_months: input.recurring_cap_months,
      p_primary_contact_name: input.primary_contact_name,
      p_primary_contact_email: input.primary_contact_email,
      p_primary_contact_phone: input.primary_contact_phone,
    });

    if (error) {
      // The function raises insufficient_privilege when the lead is not the
      // caller's, and no_data_found when it does not exist. Both are the
      // caller's problem, not a server fault.
      if (error.code === "42501") {
        return NextResponse.json(
          { error: "That lead is not assigned to you" },
          { status: 403 }
        );
      }
      if (error.code === "P0002" || error.code === "02000") {
        return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      }
      throw error;
    }

    // convert_lead_to_account() is idempotent: converting an already-converted
    // lead returns the canonical account and deal with status
    // 'already_converted' rather than raising. That is a success — a double
    // click and a retry after a timeout both land here — so it gets a 2xx and
    // the client treats both states as "converted". 201 only when this call is
    // the one that created the rows.
    const result = (data ?? {}) as Record<string, unknown>;
    const created = result.status === "converted";

    return NextResponse.json(
      { ok: true, ...result },
      { status: created ? 201 : 200 }
    );
  } catch (err) {
    console.error("Lead convert error:", err);
    return NextResponse.json({ error: "Conversion failed" }, { status: 500 });
  }
}
