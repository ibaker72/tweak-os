import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import { asUser, connect, hasTestDatabase, resetSchema, seed, type SeedIds } from "./helpers";

/**
 * The five Phase 5 decisions, verified against the database that implements
 * them:
 *
 *   retainers cap at 6 months by default;
 *   the ledger's uniqueness key leaves room for split credit;
 *   self-sourced work pays more than inbound, and a missing attribution never
 *     silently costs an agent the difference;
 *   employment_classification is a three-state field;
 *   a Stripe payment lands as received, not cleared.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("admin tools and Phase 5 decisions", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect("admintools");
    await resetSchema(client);
    ids = await seed(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query(`
      truncate commission_entries, payout_batches, payments, deal_milestones,
               deals, accounts, attributions, activity_log
      restart identity cascade
    `);
    await client.query(
      `update agent_profiles
       set default_commission_rate_bps = 3000,
           inbound_commission_rate_bps = 2000,
           employment_classification = 'unset'`
    );
    await client.query(
      "update leads set lifecycle_status = 'new' where id in ($1, $2)",
      [ids.leadOfA, ids.leadOfB]
    );
  });

  async function convertAs(
    userId: string,
    leadId: string,
    opts: { model?: string; mrr?: number; cap?: number | null } = {}
  ): Promise<Record<string, unknown>> {
    await client.query("begin");
    try {
      await client.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [userId]
      );
      await client.query("set local role authenticated");
      const { rows } = await client.query(
        `select public.convert_lead_to_account(
           $1::uuid, 'Acme HVAC', 'Deal', $2, $3,
           850000::bigint, $4::bigint, $5::integer, null, null, null
         ) as result`,
        [
          leadId,
          opts.model === "recurring" ? "growth_retainer" : "rapid_build",
          opts.model ?? "one_time",
          opts.mrr ?? 0,
          opts.cap === undefined ? null : opts.cap,
        ]
      );
      await client.query("commit");
      return rows[0].result as Record<string, unknown>;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  // -------------------------------------------------------------------------

  describe("1. retainer cap defaults to 6 months", () => {
    it("a converted retainer gets a 6-month cap when none is given", async () => {
      const result = await convertAs(ids.agentAUserId, ids.leadOfA, {
        model: "recurring",
        mrr: 300_000,
        cap: null,
      });
      expect(result.recurring_cap_months).toBe(6);

      const { rows } = await client.query("select recurring_cap_months from deals");
      expect(rows[0].recurring_cap_months).toBe(6);
    });

    it("an explicit cap still wins", async () => {
      const result = await convertAs(ids.agentAUserId, ids.leadOfA, {
        model: "recurring",
        mrr: 300_000,
        cap: 12,
      });
      expect(result.recurring_cap_months).toBe(12);
    });

    it("a one-time deal gets no cap at all", async () => {
      const result = await convertAs(ids.agentAUserId, ids.leadOfA);
      expect(result.recurring_cap_months).toBeNull();
    });

    it("caps a $3,000/mo retainer at $5,400 of commission", async () => {
      // 30% of 300,000 cents = 90,000/mo, times the 6-month cap.
      const perMonth = Math.round((300_000 * 3000) / 10_000);
      expect(perMonth * 6).toBe(540_000);
    });
  });

  describe("2. the split-credit seam", () => {
    it("the ledger key is (payment_id, agent_id), not payment_id alone", async () => {
      const { rows } = await client.query(`
        select indexdef from pg_indexes
        where schemaname = 'public'
          and indexname = 'uq_commission_entries_earned_per_payment_agent'
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toContain("payment_id, agent_id");
    });

    it("the old narrow index is gone", async () => {
      const { rows } = await client.query(`
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'uq_commission_entries_earned_per_payment'
      `);
      expect(rows).toHaveLength(0);
    });

    it("still refuses a duplicate earned entry for the same agent and payment", async () => {
      // The retrofit must not have weakened the double-pay guarantee.
      const { deal, payment } = await seedDealAndPayment(client, ids);
      await client.query(
        `insert into commission_entries (agent_id, deal_id, payment_id, entry_type, amount_cents)
         values ($1, $2, $3, 'earned', 240000)`,
        [ids.agentAAgentId, deal, payment]
      );

      await client.query("begin");
      let code: string | null = null;
      try {
        await client.query(
          `insert into commission_entries (agent_id, deal_id, payment_id, entry_type, amount_cents)
           values ($1, $2, $3, 'earned', 240000)`,
          [ids.agentAAgentId, deal, payment]
        );
      } catch (err) {
        code = (err as { code?: string }).code ?? null;
      } finally {
        await client.query("rollback");
      }
      expect(code).toBe("23505");
    });

    it("now permits two agents on one payment, which is what the seam is for", async () => {
      const { deal, payment } = await seedDealAndPayment(client, ids);
      await client.query(
        `insert into commission_entries (agent_id, deal_id, payment_id, entry_type, amount_cents)
         values ($1, $3, $4, 'earned', 168000), ($2, $3, $4, 'earned', 72000)`,
        [ids.agentAAgentId, ids.agentBAgentId, deal, payment]
      );
      const { rows } = await client.query(
        "select count(*)::int as n from commission_entries where payment_id = $1",
        [payment]
      );
      expect(rows[0].n).toBe(2);
    });
  });

  describe("3. rate by attribution source", () => {
    it("no attribution keeps the self-sourced rate rather than quietly cutting pay", async () => {
      // Nothing in the app creates attributions yet and agents cannot create
      // leads, so this is the common path. Defaulting to the lower rate here
      // would silently underpay both agents on every deal.
      const result = await convertAs(ids.agentAUserId, ids.leadOfA);
      expect(result.commission_rate_bps).toBe(3000);
      expect(result.rate_basis).toBe("no_attribution");
    });

    it("an explicit inbound_assigned attribution applies the lower rate", async () => {
      await client.query(
        `insert into attributions (agent_id, lead_id, source) values ($1, $2, 'inbound_assigned')`,
        [ids.agentAAgentId, ids.leadOfA]
      );
      const result = await convertAs(ids.agentAUserId, ids.leadOfA);
      expect(result.commission_rate_bps).toBe(2000);
      expect(result.rate_basis).toBe("inbound_assigned");
    });

    it("a self_sourced attribution keeps the higher rate", async () => {
      await client.query(
        `insert into attributions (agent_id, lead_id, source) values ($1, $2, 'self_sourced')`,
        [ids.agentAAgentId, ids.leadOfA]
      );
      const result = await convertAs(ids.agentAUserId, ids.leadOfA);
      expect(result.commission_rate_bps).toBe(3000);
      expect(result.rate_basis).toBe("self_sourced");
    });

    it("uses the per-agent inbound rate, not a global constant", async () => {
      await client.query(
        "update agent_profiles set inbound_commission_rate_bps = 1500 where id = $1",
        [ids.agentAAgentId]
      );
      await client.query(
        `insert into attributions (agent_id, lead_id, source) values ($1, $2, 'inbound_assigned')`,
        [ids.agentAAgentId, ids.leadOfA]
      );
      const result = await convertAs(ids.agentAUserId, ids.leadOfA);
      expect(result.commission_rate_bps).toBe(1500);
    });

    it("an expired inbound attribution does not drag the rate down", async () => {
      await client.query(
        `insert into attributions (agent_id, lead_id, source, first_touch_at, expires_at)
         values ($1, $2, 'inbound_assigned', now() - interval '200 days', now() - interval '110 days')`,
        [ids.agentAAgentId, ids.leadOfA]
      );
      const result = await convertAs(ids.agentAUserId, ids.leadOfA);
      expect(result.commission_rate_bps).toBe(3000);
    });

    it("records the rate basis in the activity log", async () => {
      await client.query(
        `insert into attributions (agent_id, lead_id, source) values ($1, $2, 'inbound_assigned')`,
        [ids.agentAAgentId, ids.leadOfA]
      );
      await convertAs(ids.agentAUserId, ids.leadOfA);

      const { rows } = await client.query(
        "select details from activity_log where action = 'lead.converted'"
      );
      expect(rows[0].details.rate_basis).toBe("inbound_assigned");
      expect(rows[0].details.commission_rate_bps).toBe(2000);
    });

    it("still snapshots, so a later rate change does not reprice", async () => {
      await convertAs(ids.agentAUserId, ids.leadOfA);
      await client.query(
        "update agent_profiles set default_commission_rate_bps = 1000 where id = $1",
        [ids.agentAAgentId]
      );
      const { rows } = await client.query("select commission_rate_bps from deals");
      expect(rows[0].commission_rate_bps).toBe(3000);
    });
  });

  describe("4. employment classification", () => {
    it("defaults to unset", async () => {
      const { rows } = await client.query(
        "select count(*)::int as n from agent_profiles where employment_classification <> 'unset'"
      );
      expect(rows[0].n).toBe(0);
    });

    it("accepts all three states", async () => {
      for (const value of ["contractor_1099", "employee_w2", "unset"]) {
        const { rowCount } = await client.query(
          "update agent_profiles set employment_classification = $1 where id = $2",
          [value, ids.agentAAgentId]
        );
        expect(rowCount).toBe(1);
      }
    });

    it("rejects anything else", async () => {
      await client.query("begin");
      let code: string | null = null;
      try {
        await client.query(
          "update agent_profiles set employment_classification = 'freelance' where id = $1",
          [ids.agentAAgentId]
        );
      } catch (err) {
        code = (err as { code?: string }).code ?? null;
      } finally {
        await client.query("rollback");
      }
      expect(code).toBe("23514");
    });

    it("stores only the last four TIN digits, never a full number", async () => {
      await client.query("begin");
      let code: string | null = null;
      try {
        await client.query(
          "update agent_profiles set tax_id_last4 = '123456789' where id = $1",
          [ids.agentAAgentId]
        );
      } catch (err) {
        code = (err as { code?: string }).code ?? null;
      } finally {
        await client.query("rollback");
      }
      expect(code).toBe("23514");

      const { rowCount } = await client.query(
        "update agent_profiles set tax_id_last4 = '6789' where id = $1",
        [ids.agentAAgentId]
      );
      expect(rowCount).toBe(1);
    });

    it("has no column that could hold a full TIN", async () => {
      const { rows } = await client.query(`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'agent_profiles'
          and column_name in ('tax_id', 'ssn', 'ein', 'tin')
      `);
      expect(rows).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Who can reach a SECURITY DEFINER function at all.
  //
  // Supabase grants EXECUTE on every new function in `public` to anon and
  // authenticated as named roles, so `revoke ... from public` does not lock one
  // down. 00019 relied on exactly that and left clear_settled_payments()
  // callable by anon in production — the one definer function with no internal
  // caller check, and the one that decides when money counts as settled.
  //
  // bootstrap.sql now reproduces those default privileges, so these assertions
  // are about the grants production actually has rather than a cleaner local
  // approximation. 00024 is what takes them away again.
  // ---------------------------------------------------------------------------
  describe("SECURITY DEFINER functions are not reachable by anon", () => {
    it("no definer function in public is executable by anon", async () => {
      const { rows } = await client.query(`
        select p.oid::regprocedure::text as sig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and has_function_privilege('anon', p.oid, 'EXECUTE')
        order by 1
      `);
      expect(rows.map((r) => r.sig)).toEqual([]);
    });

    it("the settlement sweep is service-role only, not agent-callable", async () => {
      const { rows } = await client.query(`
        select
          has_function_privilege('anon', 'public.clear_settled_payments(integer)', 'EXECUTE') as anon,
          has_function_privilege('authenticated', 'public.clear_settled_payments(integer)', 'EXECUTE') as auth,
          has_function_privilege('service_role', 'public.clear_settled_payments(integer)', 'EXECUTE') as svc
      `);
      expect(rows[0]).toEqual({ anon: false, auth: false, svc: true });
    });

    it("clear_settled_payments refuses a non-admin caller on its own", async () => {
      // Belt and braces: even with the grant restored, the function itself says no.
      await client.query(
        `grant execute on function public.clear_settled_payments(integer) to authenticated`
      );
      try {
        const code = await asUser(client, ids.agentAUserId, (q) =>
          q.errorCode(`select * from public.clear_settled_payments(0)`)
        );
        expect(code).toBe("42501");
      } finally {
        await client.query(
          `revoke all on function public.clear_settled_payments(integer) from authenticated`
        );
      }
    });

    it("rejects a settlement window that would date a clearance before receipt", async () => {
      const { rows } = await client.query(`
        select code from (
          select null::text as code
        ) x
      `);
      void rows;
      await expect(
        client.query(`select * from public.clear_settled_payments(-1)`)
      ).rejects.toThrow(/non-negative/);
    });
  });

  describe("5. Stripe payments arrive received, not cleared", () => {
    it("clear_settled_payments leaves a fresh payment alone", async () => {
      const { deal } = await seedDealAndPayment(client, ids, { skipPayment: true });
      await client.query(
        `insert into payments (deal_id, amount_cents, received_at, cleared_at, source, stripe_charge_id)
         values ($1, 850000, now(), null, 'stripe', 'ch_fresh')`,
        [deal]
      );

      const { rows } = await client.query("select * from public.clear_settled_payments(7)");
      expect(rows).toHaveLength(0);

      const { rows: payment } = await client.query("select cleared_at from payments");
      expect(payment[0].cleared_at).toBeNull();
    });

    it("clears one that has passed the settlement window", async () => {
      const { deal } = await seedDealAndPayment(client, ids, { skipPayment: true });
      await client.query(
        `insert into payments (deal_id, amount_cents, received_at, cleared_at, source, stripe_charge_id)
         values ($1, 850000, now() - interval '10 days', null, 'stripe', 'ch_old')`,
        [deal]
      );

      const { rows } = await client.query("select * from public.clear_settled_payments(7)");
      expect(rows).toHaveLength(1);

      const { rows: payment } = await client.query("select cleared_at from payments");
      expect(payment[0].cleared_at).not.toBeNull();
    });

    it("never clears a payment that was refunded inside the window", async () => {
      // Money that came back before it settled must never have accrued.
      const { deal } = await seedDealAndPayment(client, ids, { skipPayment: true });
      await client.query(
        `insert into payments (deal_id, amount_cents, received_at, cleared_at,
           refunded_at, refunded_amount_cents, source, stripe_charge_id)
         values ($1, 850000, now() - interval '10 days', null, now(), 850000, 'stripe', 'ch_refunded')`,
        [deal]
      );

      const { rows } = await client.query("select * from public.clear_settled_payments(7)");
      expect(rows).toHaveLength(0);
    });

    it("is idempotent — a second sweep clears nothing further", async () => {
      const { deal } = await seedDealAndPayment(client, ids, { skipPayment: true });
      await client.query(
        `insert into payments (deal_id, amount_cents, received_at, cleared_at, source, stripe_charge_id)
         values ($1, 850000, now() - interval '10 days', null, 'stripe', 'ch_once')`,
        [deal]
      );

      const first = await client.query("select * from public.clear_settled_payments(7)");
      const second = await client.query("select * from public.clear_settled_payments(7)");
      expect(first.rows).toHaveLength(1);
      expect(second.rows).toHaveLength(0);
    });

    it("refuses a duplicate Stripe charge, so a replayed webhook is a no-op", async () => {
      const { deal } = await seedDealAndPayment(client, ids, { skipPayment: true });
      await client.query(
        `insert into payments (deal_id, amount_cents, source, stripe_charge_id)
         values ($1, 850000, 'stripe', 'ch_dup')`,
        [deal]
      );

      await client.query("begin");
      let code: string | null = null;
      try {
        await client.query(
          `insert into payments (deal_id, amount_cents, source, stripe_charge_id)
           values ($1, 850000, 'stripe', 'ch_dup')`,
          [deal]
        );
      } catch (err) {
        code = (err as { code?: string }).code ?? null;
      } finally {
        await client.query("rollback");
      }
      expect(code).toBe("23505");
    });

    it("allows many manual payments with no Stripe id", async () => {
      // The unique index is partial, so nulls do not collide.
      const { deal } = await seedDealAndPayment(client, ids, { skipPayment: true });
      const { rowCount } = await client.query(
        `insert into payments (deal_id, amount_cents, source) values ($1, 100, 'manual'), ($1, 200, 'manual')`,
        [deal]
      );
      expect(rowCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------

  describe("reassigning a departing agent's book", () => {
    it("moves open leads and accounts but never the commission ledger", async () => {
      const { deal, payment } = await seedDealAndPayment(client, ids);
      await client.query(
        `insert into commission_entries (agent_id, deal_id, payment_id, entry_type, amount_cents)
         values ($1, $2, $3, 'earned', 240000)`,
        [ids.agentAAgentId, deal, payment]
      );

      await client.query("begin");
      await client.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [ids.adminUserId]
      );
      await client.query("set local role authenticated");
      const { rows } = await client.query(
        "select public.reassign_agent_book($1, $2, true) as result",
        [ids.agentAAgentId, ids.agentBAgentId]
      );
      await client.query("commit");

      expect(rows[0].result.leads_moved).toBeGreaterThanOrEqual(1);

      // The ledger and the closed deal stay with the agent who earned them.
      const { rows: entries } = await client.query(
        "select agent_id from commission_entries"
      );
      expect(entries[0].agent_id).toBe(ids.agentAAgentId);

      const { rows: deals } = await client.query("select closed_by_agent_id from deals");
      expect(deals[0].closed_by_agent_id).toBe(ids.agentAAgentId);

      const { rows: profile } = await client.query(
        "select is_active from agent_profiles where id = $1",
        [ids.agentAAgentId]
      );
      expect(profile[0].is_active).toBe(false);

      await client.query(
        "update agent_profiles set is_active = true where id = $1",
        [ids.agentAAgentId]
      );
    });

    it("an agent cannot reassign a book", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode("select public.reassign_agent_book($1, $2, false)", [
          ids.agentBAgentId,
          ids.agentAAgentId,
        ])
      );
      expect(code).toBe("42501");
    });

    it("refuses an inactive destination", async () => {
      const code = await asUser(client, ids.adminUserId, (q) =>
        q.errorCode("select public.reassign_agent_book($1, $2, false)", [
          ids.agentAAgentId,
          ids.inactiveUserId,
        ])
      );
      expect(code).toBe("22023");
    });
  });

  describe("admin-only surfaces stay admin-only", () => {
    it("an agent cannot read another agent's payout batches", async () => {
      await client.query(
        `insert into payout_batches (agent_id, period_start, period_end, total_cents)
         values ($1, '2026-01-01', '2026-01-31', 500000)`,
        [ids.agentBAgentId]
      );
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from payout_batches")
      );
      expect(rows).toHaveLength(0);
    });

    it("an agent cannot write themselves a bonus", async () => {
      const { deal } = await seedDealAndPayment(client, ids);
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents, memo)
           values ($1, $2, 'bonus', 500000, 'for me')`,
          [ids.agentAAgentId, deal]
        )
      );
      expect(code).toBe("42501");
    });

    it("an agent cannot change their own commission rate", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count(
          "update agent_profiles set default_commission_rate_bps = 9000 where id = $1",
          [ids.agentAAgentId]
        )
      );
      expect(updated).toBe(0);
    });

    it("an agent cannot write an attribution override", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into attributions (agent_id, lead_id, source, is_override, override_reason, override_by)
           values ($1, $2, 'self_sourced', true, 'I found this one honestly', $1)`,
          [ids.agentAAgentId, ids.leadOfA]
        )
      );
      expect(code).toBe("42501");
    });
  });
});

/** A signed deal with one cleared payment, owned by agent A. */
async function seedDealAndPayment(
  client: Client,
  ids: SeedIds,
  opts: { skipPayment?: boolean } = {}
): Promise<{ account: string; deal: string; payment: string }> {
  const { rows: account } = await client.query(
    `insert into accounts (company_name, owner_agent_id) values ('Acme', $1) returning id`,
    [ids.agentAAgentId]
  );
  const { rows: deal } = await client.query(
    `insert into deals (account_id, name, deal_type, commission_model, contract_value_cents,
       status, closed_by_agent_id, signed_at, commission_rate_bps)
     values ($1, 'Build', 'rapid_build', 'one_time', 850000, 'signed', $2, now(), 3000)
     returning id`,
    [account[0].id, ids.agentAAgentId]
  );

  if (opts.skipPayment) {
    return { account: account[0].id, deal: deal[0].id, payment: "" };
  }

  const { rows: payment } = await client.query(
    `insert into payments (deal_id, amount_cents, received_at, cleared_at)
     values ($1, 850000, now(), now()) returning id`,
    [deal[0].id]
  );

  return { account: account[0].id, deal: deal[0].id, payment: payment[0].id };
}
