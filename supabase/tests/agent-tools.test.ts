import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import { asUser, connect, hasTestDatabase, resetSchema, seed, type SeedIds } from "./helpers";

/**
 * Phase 4's central claim: everything an agent sees is scoped by RLS, not by a
 * WHERE clause someone remembered to write.
 *
 * So these tests run the *unscoped* queries the pages and routes actually
 * issue — no `assigned_to = me` filter anywhere — as agent A and agent B, and
 * assert each one comes back scoped anyway. If a policy regressed, the query
 * would quietly return a teammate's rows and these tests would fail.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("agent-facing tools", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect("agenttools");
    await resetSchema(client);
    ids = await seed(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query(`
      truncate commission_entries, payout_batches, payments, deal_milestones,
               deals, accounts, agent_template_overrides, outreach_sequences,
               activity_log, attributions
      restart identity cascade
    `);
  });


  /**
   * Run as a given user and COMMIT.
   *
   * asUser() rolls back, which is right for read scoping but useless for
   * convert_lead_to_account: its whole job is to write an account, a deal, an
   * attribution update and a log row, and those have to survive to be checked.
   * `set local role` unwinds at commit, so the connection is clean afterwards.
   */
  async function asUserCommitting<T>(
    userId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    await client.query("begin");
    try {
      await client.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [userId]
      );
      await client.query("set local role authenticated");
      const result = await fn();
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  /** Convert as `userId`, committing, and return the function's JSON result. */
  async function convertAs(
    userId: string,
    leadId: string
  ): Promise<Record<string, unknown>> {
    return asUserCommitting(userId, async () => {
      const { rows } = await client.query(
        `select public.convert_lead_to_account(
           $1::uuid, 'Acme HVAC', 'Rapid Build', 'rapid_build', 'one_time',
           850000::bigint, 0::bigint, null::integer, null, null, null
         ) as result`,
        [leadId]
      );
      return rows[0].result as Record<string, unknown>;
    });
  }

  // -------------------------------------------------------------------------
  // /my/queue
  // -------------------------------------------------------------------------

  describe("my queue is scoped by RLS, not by a filter", () => {
    /** Exactly the query the page runs — note the absence of assigned_to. */
    const QUEUE_SQL = `
      select id, business_name, next_action_date, score
      from leads
      where archived_at is null and deleted_at is null
        and lifecycle_status in ('new','enriched','contacted','replied','meeting_booked')
      order by next_action_date asc nulls last, score desc
      limit 100
    `;

    it("agent A's unfiltered queue query returns only agent A's leads", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ business_name: string }>(QUEUE_SQL)
      );
      expect(rows.map((r) => r.business_name)).toEqual(["Lead of A"]);
    });

    it("agent B's identical query returns only agent B's leads", async () => {
      const rows = await asUser(client, ids.agentBUserId, (q) =>
        q.rows<{ business_name: string }>(QUEUE_SQL)
      );
      expect(rows.map((r) => r.business_name)).toEqual(["Lead of B"]);
    });

    it("the admin's identical query returns everything", async () => {
      const rows = await asUser(client, ids.adminUserId, (q) => q.rows(QUEUE_SQL));
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    it("sorts scheduled work before unscheduled", async () => {
      await client.query(
        "update leads set next_action_date = current_date where id = $1",
        [ids.leadOfA]
      );
      const rows = await asUser(client, ids.adminUserId, (q) =>
        q.rows<{ next_action_date: string | null }>(QUEUE_SQL)
      );
      expect(rows[0].next_action_date).not.toBeNull();
      expect(rows[rows.length - 1].next_action_date).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Inline actions
  // -------------------------------------------------------------------------

  describe("queue actions", () => {
    it("an agent can log activity against their own lead", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into activity_log (lead_id, module, action, entity_type, entity_id, details)
           values ($1, 'leads', 'lead.call_logged', 'lead', $1, '{"outcome":"connected"}'::jsonb)`,
          [ids.leadOfA]
        )
      );
      expect(code).toBeNull();
    });

    it("an agent cannot log activity against a teammate's lead", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into activity_log (lead_id, module, action, entity_type, entity_id)
           values ($1, 'leads', 'lead.call_logged', 'lead', $1)`,
          [ids.leadOfB]
        )
      );
      expect(code).toBe("42501");
    });

    it("an agent can set next_action_date on their own lead", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count(
          "update leads set next_action_date = current_date + 3, next_action = 'Follow up' where id = $1",
          [ids.leadOfA]
        )
      );
      expect(updated).toBe(1);
    });

    it("an agent cannot advance a teammate's lead", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update leads set lifecycle_status = 'won' where id = $1", [ids.leadOfB])
      );
      expect(updated).toBe(0);
    });

    it("an agent only sees activity on their own leads", async () => {
      await client.query(
        `insert into activity_log (lead_id, module, action, entity_type, entity_id) values
           ($1, 'leads', 'lead.note_added', 'lead', $1),
           ($2, 'leads', 'lead.note_added', 'lead', $2)`,
        [ids.leadOfA, ids.leadOfB]
      );
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from activity_log where entity_type = 'lead'")
      );
      expect(rows).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Convert to Account
  // -------------------------------------------------------------------------

  describe("convert_lead_to_account", () => {
    it("an agent converts their own lead and gets an account plus a draft deal", async () => {
      const result = await convertAs(ids.agentAUserId, ids.leadOfA);

      expect(result.account_id).toBeTruthy();
      expect(result.deal_id).toBeTruthy();
      // The rate came from the agent's profile, not from any argument — there
      // is no rate parameter to pass.
      expect(result.commission_rate_bps).toBe(3000);
      expect(result.credited_to).toBe(ids.agentAAgentId);
    });

    it("the created deal is a draft that an admin still has to sign", async () => {
      await convertAs(ids.agentAUserId, ids.leadOfA);

      const { rows } = await client.query(
        "select status, signed_at, commission_rate_bps, closed_by_agent_id from deals"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("draft");
      expect(rows[0].signed_at).toBeNull();
      expect(rows[0].commission_rate_bps).toBe(3000);
      expect(rows[0].closed_by_agent_id).toBe(ids.agentAAgentId);
    });

    it("marks the lead won and links the account back to it", async () => {
      await convertAs(ids.agentAUserId, ids.leadOfA);

      const { rows: lead } = await client.query(
        "select lifecycle_status from leads where id = $1",
        [ids.leadOfA]
      );
      expect(lead[0].lifecycle_status).toBe("won");

      const { rows: account } = await client.query("select lead_id from accounts");
      expect(account[0].lead_id).toBe(ids.leadOfA);
    });

    it("refuses to convert a teammate's lead", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `select public.convert_lead_to_account(
             $1::uuid, 'Acme', 'Build', 'rapid_build', 'one_time',
             850000::bigint, 0::bigint, null::integer, null, null, null)`,
          [ids.leadOfB]
        )
      );
      expect(code).toBe("42501");

      const { rows } = await client.query("select count(*)::int as n from deals");
      expect(rows[0].n).toBe(0);
    });

    it("snapshots the current rate, so a later rate change does not reprice it", async () => {
      await client.query(
        "update agent_profiles set default_commission_rate_bps = 2000 where id = $1",
        [ids.agentAAgentId]
      );

      await convertAs(ids.agentAUserId, ids.leadOfA);

      await client.query(
        "update agent_profiles set default_commission_rate_bps = 3000 where id = $1",
        [ids.agentAAgentId]
      );

      const { rows } = await client.query("select commission_rate_bps from deals");
      expect(rows[0].commission_rate_bps).toBe(2000);
    });

    it("credits the lead's owner, not the admin who clicked convert", async () => {
      const result = await convertAs(ids.adminUserId, ids.leadOfA);
      expect(result.credited_to).toBe(ids.agentAAgentId);

      const { rows } = await client.query("select closed_by_agent_id from deals");
      expect(rows[0].closed_by_agent_id).toBe(ids.agentAAgentId);
    });

    it("resolves the winning attribution and leaves the losers as a record", async () => {
      await client.query(
        `insert into attributions (agent_id, lead_id, source, first_touch_at, expires_at) values
           ($1, $3, 'referral_link', now() - interval '10 days', now() + interval '80 days'),
           ($2, $3, 'manual_intro',  now() - interval '5 days',  now() + interval '85 days')`,
        [ids.agentAAgentId, ids.agentBAgentId, ids.leadOfA]
      );

      await convertAs(ids.agentAUserId, ids.leadOfA);

      const { rows } = await client.query(
        "select agent_id, resolved_at from attributions order by first_touch_at"
      );
      // Earliest non-expired first touch wins; the loser stays unresolved as
      // the record of who else was in play.
      expect(rows[0].agent_id).toBe(ids.agentAAgentId);
      expect(rows[0].resolved_at).not.toBeNull();
      expect(rows[1].resolved_at).toBeNull();
    });

    it("skips an expired first touch in favour of a live one", async () => {
      await client.query(
        `insert into attributions (agent_id, lead_id, source, first_touch_at, expires_at) values
           ($1, $3, 'referral_link', now() - interval '200 days', now() - interval '110 days'),
           ($2, $3, 'manual_intro',  now() - interval '5 days',  now() + interval '85 days')`,
        [ids.agentAAgentId, ids.agentBAgentId, ids.leadOfA]
      );

      await convertAs(ids.agentAUserId, ids.leadOfA);

      const { rows } = await client.query(
        "select agent_id from attributions where resolved_at is not null"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].agent_id).toBe(ids.agentBAgentId);
    });

    it("an admin override wins over an earlier first touch", async () => {
      await client.query(
        `insert into attributions
           (agent_id, lead_id, source, first_touch_at, expires_at, is_override, override_reason, override_by)
         values
           ($1, $3, 'referral_link', now() - interval '30 days', now() + interval '60 days', false, null, null),
           ($2, $3, 'manual_intro',  now() - interval '1 days',  now() + interval '89 days', true, 'Agent B ran the whole cycle', $4)`,
        [ids.agentAAgentId, ids.agentBAgentId, ids.leadOfA, ids.adminAgentId]
      );

      await convertAs(ids.adminUserId, ids.leadOfA);

      const { rows } = await client.query(
        "select agent_id from attributions where resolved_at is not null"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].agent_id).toBe(ids.agentBAgentId);
    });

    it("writes the conversion to activity_log", async () => {
      await convertAs(ids.agentAUserId, ids.leadOfA);

      const { rows } = await client.query(
        "select action, details from activity_log where action = 'lead.converted'"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].details.commission_rate_bps).toBe(3000);
      expect(rows[0].details.credited_to).toBe(ids.agentAAgentId);
    });

    it("agents still have no direct insert on deals or accounts", async () => {
      // The function is the only way in — that is what keeps an agent from
      // writing their own commission_rate_bps.
      const dealCode = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into deals (account_id, name, deal_type, commission_model,
             contract_value_cents, status, closed_by_agent_id, signed_at, commission_rate_bps)
           values (gen_random_uuid(), 'Forged', 'rapid_build', 'one_time', 100, 'signed', $1, now(), 10000)`,
          [ids.agentAAgentId]
        )
      );
      expect(dealCode).toBe("42501");

      const acctCode = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into accounts (company_name, owner_agent_id) values ('Forged', $1)",
          [ids.agentAAgentId]
        )
      );
      expect(acctCode).toBe("42501");
    });
  });

  // -------------------------------------------------------------------------
  // /my/pipeline and /my/commissions
  // -------------------------------------------------------------------------

  describe("pipeline and commissions scoping", () => {
    beforeEach(async () => {
      const { rows: accounts } = await client.query(
        `insert into accounts (company_name, owner_agent_id) values ('A Co', $1), ('B Co', $2)
         returning id, company_name`,
        [ids.agentAAgentId, ids.agentBAgentId]
      );
      const aAcct = accounts.find((a) => a.company_name === "A Co").id;
      const bAcct = accounts.find((a) => a.company_name === "B Co").id;

      const { rows: deals } = await client.query(
        `insert into deals (account_id, name, deal_type, commission_model,
           contract_value_cents, status, closed_by_agent_id, signed_at, commission_rate_bps)
         values ($1, 'A deal', 'rapid_build', 'one_time', 850000, 'signed', $3, now(), 3000),
                ($2, 'B deal', 'rapid_build', 'one_time', 400000, 'signed', $4, now(), 3000)
         returning id, name`,
        [aAcct, bAcct, ids.agentAAgentId, ids.agentBAgentId]
      );

      await client.query(
        `insert into commission_entries (agent_id, deal_id, entry_type, amount_cents, rate_bps_applied, basis_cents)
         values ($1, $3, 'earned', 255000, 3000, 850000),
                ($2, $4, 'earned', 120000, 3000, 400000)`,
        [
          ids.agentAAgentId,
          ids.agentBAgentId,
          deals.find((d) => d.name === "A deal").id,
          deals.find((d) => d.name === "B deal").id,
        ]
      );
    });

    it("the unfiltered pipeline query returns only the caller's deals", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ name: string }>("select name from deals")
      );
      expect(rows.map((r) => r.name)).toEqual(["A deal"]);
    });

    it("the unfiltered account lookup returns only the caller's accounts", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ company_name: string }>("select company_name from accounts")
      );
      expect(rows.map((r) => r.company_name)).toEqual(["A Co"]);
    });

    it("the unfiltered ledger query returns only the caller's entries", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ amount_cents: number }>("select amount_cents from commission_entries")
      );
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount_cents)).toBe(255_000);
    });

    it("an agent cannot see a teammate's commission total even in an aggregate", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ total: string }>(
          "select coalesce(sum(amount_cents), 0)::bigint as total from commission_entries"
        )
      );
      // 255,000 only — B's 120,000 is invisible, so it cannot leak through a SUM.
      expect(Number(rows[0].total)).toBe(255_000);
    });
  });

  // -------------------------------------------------------------------------
  // Template overrides
  // -------------------------------------------------------------------------

  describe("per-agent template overrides", () => {
    async function firstTemplate(): Promise<string> {
      const { rows } = await client.query("select id from outreach_templates limit 1");
      return rows[0].id;
    }

    it("an agent can create and read their own override", async () => {
      const templateId = await firstTemplate();
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into agent_template_overrides (agent_id, template_id, body) values ($1, $2, 'My wording')",
          [ids.agentAAgentId, templateId]
        )
      );
      expect(code).toBeNull();
    });

    it("an agent cannot write an override onto a teammate", async () => {
      const templateId = await firstTemplate();
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into agent_template_overrides (agent_id, template_id, body) values ($1, $2, 'Sabotage')",
          [ids.agentBAgentId, templateId]
        )
      );
      expect(code).toBe("42501");
    });

    it("an agent cannot see a teammate's overrides", async () => {
      const templateId = await firstTemplate();
      await client.query(
        "insert into agent_template_overrides (agent_id, template_id, body) values ($1, $2, 'B private')",
        [ids.agentBAgentId, templateId]
      );
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from agent_template_overrides")
      );
      expect(rows).toHaveLength(0);
    });

    it("agents still cannot edit the shared team template", async () => {
      const templateId = await firstTemplate();
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update outreach_templates set body = 'hijacked' where id = $1", [templateId])
      );
      expect(updated).toBe(0);
    });

    it("rejects an override that overrides nothing", async () => {
      const templateId = await firstTemplate();
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into agent_template_overrides (agent_id, template_id) values ($1, $2)",
          [ids.agentAAgentId, templateId]
        )
      );
      expect(code).toBe("23514");
    });

    it("allows only one override per agent per template", async () => {
      const templateId = await firstTemplate();
      await client.query(
        "insert into agent_template_overrides (agent_id, template_id, body) values ($1, $2, 'first')",
        [ids.agentAAgentId, templateId]
      );
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into agent_template_overrides (agent_id, template_id, body) values ($1, $2, 'second')",
          [ids.agentAAgentId, templateId]
        )
      );
      expect(code).toBe("23505");
    });
  });

  // -------------------------------------------------------------------------
  // Send log and SMS scoping
  // -------------------------------------------------------------------------

  describe("send log", () => {
    it("ties a send to the template and the activity_log row it produced", async () => {
      const { rows: t } = await client.query("select id from outreach_templates limit 1");
      const { rows: log } = await client.query(
        `insert into activity_log (lead_id, module, action, entity_type, entity_id)
         values ($1, 'leads', 'lead.email_logged', 'lead', $1) returning id`,
        [ids.leadOfA]
      );

      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into outreach_sequences
             (lead_id, agent_id, channel, body, status, sent_at, template_id, activity_log_id)
           values ($1, $2, 'email', 'Hi', 'sent', now(), $3, $4)`,
          [ids.leadOfA, ids.agentAAgentId, t[0].id, log[0].id]
        )
      );
      expect(code).toBeNull();
    });

    it("an agent cannot write a send log against a teammate's lead", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into outreach_sequences (lead_id, agent_id, channel, body, status)
           values ($1, $2, 'email', 'Hi', 'sent')`,
          [ids.leadOfB, ids.agentAAgentId]
        )
      );
      expect(code).toBe("42501");
    });
  });

  describe("SMS respects agent scoping", () => {
    it("the lead lookup /api/sms/send performs returns nothing for a teammate's lead", async () => {
      // The route resolves the lead through the RLS-bound client before it
      // will send anything, so an agent messaging someone else's lead gets a
      // "lead not found" rather than a delivered message.
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id, phone from leads where id = $1", [ids.leadOfB])
      );
      expect(rows).toHaveLength(0);
    });

    it("an agent cannot read a teammate's SMS history", async () => {
      await client.query(
        `insert into sms_messages (lead_id, direction, status, body)
         values ($1, 'outbound', 'sent', 'to B')`,
        [ids.leadOfB]
      );
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from sms_messages")
      );
      expect(rows).toHaveLength(0);
    });

    it("an agent can read SMS on their own lead", async () => {
      await client.query(
        `insert into sms_messages (lead_id, direction, status, body)
         values ($1, 'outbound', 'sent', 'to A')`,
        [ids.leadOfA]
      );
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from sms_messages")
      );
      expect(rows).toHaveLength(1);
    });
  });
});
