import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import { asUser, connect, hasTestDatabase, resetSchema, seed, type SeedIds } from "./helpers";

/**
 * The click-to-call security model, asserted against a real Postgres running
 * the real migrations.
 *
 * The claim under test is narrow and load-bearing: an agent can ask to call a
 * lead they own, and that is the entire extent of their write access. They
 * cannot insert a call record naming a number of their choosing, cannot edit
 * one afterwards, and cannot see a teammate's. Everything the dialer reads is
 * something the database put there.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("Twilio voice calls", () => {
  let client: Client;
  let ids: SeedIds;

  const AGENT_A_PHONE = "+15550001111";
  const AGENT_B_PHONE = "+15550002222";
  const LEAD_A_PHONE = "+19735551234";
  const LEAD_B_PHONE = "+19735559999";

  beforeAll(async () => {
    client = await connect("voice");
    await resetSchema(client);
    ids = await seed(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query("truncate voice_calls, activity_log restart identity cascade");
    await client.query(
      `update public.agent_profiles set voice_phone = case
         when id = $1 then $3 when id = $2 then $4 else null end
       where id in ($1, $2)`,
      [ids.agentAAgentId, ids.agentBAgentId, AGENT_A_PHONE, AGENT_B_PHONE]
    );
    await client.query(
      `update public.leads set phone = case
         when id = $1 then $3 when id = $2 then $4 else null end,
        phone_1 = null, phone_2 = null, sms_status = 'unknown'
       where id in ($1, $2)`,
      [ids.leadOfA, ids.leadOfB, LEAD_A_PHONE, LEAD_B_PHONE]
    );
  });

  /** Run as a user and COMMIT, so definer-function writes survive to be checked. */
  async function asUserCommitting<T>(userId: string, fn: () => Promise<T>): Promise<T> {
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

  async function requestCallAs(
    userId: string,
    leadId: string
  ): Promise<Record<string, unknown>> {
    return asUserCommitting(userId, async () => {
      const { rows } = await client.query(
        "select public.request_voice_call($1::uuid) as result",
        [leadId]
      );
      return rows[0].result as Record<string, unknown>;
    });
  }

  // -------------------------------------------------------------------------
  // private.normalize_phone — the SQL mirror of the TypeScript normaliser
  // -------------------------------------------------------------------------

  describe("private.normalize_phone", () => {
    const cases: [string | null, string | null][] = [
      ["+18622984988", "+18622984988"],
      ["8622984988", "+18622984988"],
      ["(862) 298-4988", "+18622984988"],
      ["862-298-4988", "+18622984988"],
      ["18622984988", "+18622984988"],
      ["  8622984988  ", "+18622984988"],
      ["", null],
      ["abc", null],
      ["123", null],
      ["12345", null],
      [null, null],
    ];

    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, async () => {
        const { rows } = await client.query(
          "select private.normalize_phone($1::text) as out",
          [input]
        );
        expect(rows[0].out).toBe(expected);
      });
    }
  });

  // -------------------------------------------------------------------------
  // request_voice_call
  // -------------------------------------------------------------------------

  describe("request_voice_call", () => {
    it("creates a record for a lead the agent owns", async () => {
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfA);

      expect(result.ok).toBe(true);
      expect(result.agent_phone).toBe(AGENT_A_PHONE);
      expect(result.prospect_phone).toBe(LEAD_A_PHONE);
      expect(result.agent_id).toBe(ids.agentAAgentId);
      expect(String(result.bridge_token)).toHaveLength(64);

      const { rows } = await client.query(
        "select * from voice_calls where id = $1",
        [result.call_id]
      );
      expect(rows[0]).toMatchObject({
        lead_id: ids.leadOfA,
        agent_id: ids.agentAAgentId,
        agent_phone: AGENT_A_PHONE,
        prospect_phone: LEAD_A_PHONE,
        status: "requested",
        direction: "outbound",
        twilio_call_sid: null,
      });
    });

    it("refuses a teammate's lead, and says nothing that confirms it exists", async () => {
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfB);

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("lead_not_found");
      // Identical to a lead that genuinely does not exist.
      const missing = await requestCallAs(
        ids.agentAUserId,
        "99999999-9999-4999-8999-999999999999"
      );
      expect(missing).toEqual(result);

      const { rows } = await client.query("select count(*)::int as n from voice_calls");
      expect(rows[0].n).toBe(0);
    });

    it("never leaks a teammate's phone number through the refusal", async () => {
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfB);
      expect(JSON.stringify(result)).not.toContain(LEAD_B_PHONE);
      expect(JSON.stringify(result)).not.toContain(AGENT_B_PHONE);
    });

    it("refuses when the agent has no callback number", async () => {
      await client.query(
        "update public.agent_profiles set voice_phone = null where id = $1",
        [ids.agentAAgentId]
      );
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      expect(result).toEqual({ ok: false, reason: "agent_phone_missing" });

      const { rows } = await client.query("select count(*)::int as n from voice_calls");
      expect(rows[0].n).toBe(0);
    });

    it("refuses when the lead has no phone number", async () => {
      await client.query(
        "update public.leads set phone = null, phone_1 = null, phone_2 = null where id = $1",
        [ids.leadOfA]
      );
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      expect(result).toEqual({ ok: false, reason: "lead_phone_missing" });
    });

    it("refuses when the lead's phone is unusable rather than dialing garbage", async () => {
      await client.query("update public.leads set phone = 'call us!' where id = $1", [
        ids.leadOfA,
      ]);
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      expect(result.reason).toBe("lead_phone_missing");
    });

    it("falls back through phone_1 and phone_2", async () => {
      await client.query(
        "update public.leads set phone = null, phone_1 = null, phone_2 = '(973) 555-4321' where id = $1",
        [ids.leadOfA]
      );
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      expect(result.prospect_phone).toBe("+19735554321");
    });

    it("normalises whatever format the lead's number was imported in", async () => {
      await client.query("update public.leads set phone = '(973) 555-1234' where id = $1", [
        ids.leadOfA,
      ]);
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      expect(result.prospect_phone).toBe(LEAD_A_PHONE);
    });

    it("honours do_not_contact on the voice channel too", async () => {
      await client.query(
        "update public.leads set sms_status = 'do_not_contact' where id = $1",
        [ids.leadOfA]
      );
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      expect(result).toEqual({ ok: false, reason: "lead_do_not_contact" });
    });

    it("refuses to bridge a lead to the agent's own number", async () => {
      await client.query("update public.leads set phone = $2 where id = $1", [
        ids.leadOfA,
        AGENT_A_PHONE,
      ]);
      const result = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      expect(result).toEqual({ ok: false, reason: "same_number" });
    });

    it("refuses a deactivated agent outright", async () => {
      await expect(
        requestCallAs(ids.inactiveUserId, ids.leadOfA)
      ).rejects.toThrow(/no active agent profile/);
    });

    it("lets an admin call any lead", async () => {
      await client.query(
        "update public.agent_profiles set voice_phone = '+15550009999' where id = $1",
        [ids.adminAgentId]
      );
      const result = await requestCallAs(ids.adminUserId, ids.leadOfB);
      expect(result.ok).toBe(true);
      expect(result.prospect_phone).toBe(LEAD_B_PHONE);
    });

    it("gives every call a distinct token", async () => {
      const first = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      const second = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      expect(first.bridge_token).not.toBe(second.bridge_token);
    });

    it("takes exactly one argument, so there is nothing else to forge", async () => {
      const { rows } = await client.query(`
        select p.pronargs, pg_get_function_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'request_voice_call'
      `);
      expect(rows[0].pronargs).toBe(1);
      expect(rows[0].args).toBe("p_lead_id uuid");
    });
  });

  // -------------------------------------------------------------------------
  // record_voice_call_result
  // -------------------------------------------------------------------------

  describe("record_voice_call_result", () => {
    async function recordAs(
      userId: string,
      callId: string,
      status: string,
      sid: string | null = null,
      from: string | null = null,
      error: string | null = null
    ): Promise<Record<string, unknown>> {
      return asUserCommitting(userId, async () => {
        const { rows } = await client.query(
          "select public.record_voice_call_result($1::uuid, $2, $3, $4, $5) as result",
          [callId, status, sid, from, error]
        );
        return rows[0].result as Record<string, unknown>;
      });
    }

    it("moves a requested call to initiated and stores the SID", async () => {
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      const result = await recordAs(
        ids.agentAUserId,
        call.call_id as string,
        "initiated",
        "CA123",
        "+18622984988"
      );

      expect(result.ok).toBe(true);
      const { rows } = await client.query("select * from voice_calls where id = $1", [
        call.call_id,
      ]);
      expect(rows[0].status).toBe("initiated");
      expect(rows[0].twilio_call_sid).toBe("CA123");
      expect(rows[0].from_number).toBe("+18622984988");
      expect(rows[0].started_at).not.toBeNull();
    });

    it("logs an attempt without touching the lead's lifecycle", async () => {
      const before = await client.query(
        "select lifecycle_status, contacted_at from leads where id = $1",
        [ids.leadOfA]
      );
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      await recordAs(ids.agentAUserId, call.call_id as string, "initiated", "CA123");

      const { rows: log } = await client.query(
        "select action, details from activity_log where lead_id = $1",
        [ids.leadOfA]
      );
      expect(log.map((r) => r.action)).toEqual(["lead.call_attempted"]);

      const after = await client.query(
        "select lifecycle_status, contacted_at from leads where id = $1",
        [ids.leadOfA]
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    });

    it("records a disabled call as not placed, not as an attempt", async () => {
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      await recordAs(ids.agentAUserId, call.call_id as string, "disabled", null, null, "off");

      const { rows } = await client.query("select status from voice_calls where id = $1", [
        call.call_id,
      ]);
      expect(rows[0].status).toBe("disabled");

      const { rows: log } = await client.query(
        "select action from activity_log where lead_id = $1",
        [ids.leadOfA]
      );
      expect(log.map((r) => r.action)).toEqual(["lead.call_not_placed"]);
    });

    it("records a Twilio rejection as failed with its message", async () => {
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      await recordAs(
        ids.agentAUserId,
        call.call_id as string,
        "failed",
        null,
        null,
        "Account suspended"
      );

      const { rows } = await client.query(
        "select status, error_message, completed_at from voice_calls where id = $1",
        [call.call_id]
      );
      expect(rows[0].status).toBe("failed");
      expect(rows[0].error_message).toBe("Account suspended");
      // A rejected request is not a completed call.
      expect(rows[0].completed_at).toBeNull();
    });

    it("refuses to record a teammate's call", async () => {
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      const result = await recordAs(ids.agentBUserId, call.call_id as string, "initiated");
      expect(result).toEqual({ ok: false, reason: "not_your_call" });

      const { rows } = await client.query("select status from voice_calls where id = $1", [
        call.call_id,
      ]);
      expect(rows[0].status).toBe("requested");
    });

    it("is a one-shot: a call already recorded cannot be rewritten", async () => {
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      await recordAs(ids.agentAUserId, call.call_id as string, "initiated", "CA123");

      const second = await recordAs(
        ids.agentAUserId,
        call.call_id as string,
        "failed",
        null,
        null,
        "rewritten"
      );
      expect(second).toEqual({ ok: false, reason: "already_recorded" });

      const { rows } = await client.query(
        "select status, twilio_call_sid, error_message from voice_calls where id = $1",
        [call.call_id]
      );
      expect(rows[0].status).toBe("initiated");
      expect(rows[0].twilio_call_sid).toBe("CA123");
      expect(rows[0].error_message).toBeNull();
    });

    it("cannot be used to declare a call completed", async () => {
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      await expect(
        recordAs(ids.agentAUserId, call.call_id as string, "completed")
      ).rejects.toThrow(/initiated, disabled or failed/);
    });

    it("cannot be used to fabricate an in-progress call", async () => {
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      await expect(
        recordAs(ids.agentAUserId, call.call_id as string, "in-progress")
      ).rejects.toThrow(/initiated, disabled or failed/);
    });
  });

  // -------------------------------------------------------------------------
  // RLS on voice_calls
  // -------------------------------------------------------------------------

  describe("voice_calls RLS", () => {
    let callOfA: string;
    let callOfB: string;

    beforeEach(async () => {
      callOfA = (await requestCallAs(ids.agentAUserId, ids.leadOfA)).call_id as string;
      callOfB = (await requestCallAs(ids.agentBUserId, ids.leadOfB)).call_id as string;
    });

    it("agent A sees only their own calls", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ id: string }>("select id from voice_calls")
      );
      expect(rows.map((r) => r.id)).toEqual([callOfA]);
    });

    it("agent A cannot read agent B's call by id", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from voice_calls where id = $1", [callOfB])
      );
      expect(rows).toHaveLength(0);
    });

    it("agent A cannot read a teammate's prospect number through voice_calls", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ prospect_phone: string }>("select prospect_phone from voice_calls")
      );
      expect(rows.map((r) => r.prospect_phone)).not.toContain(LEAD_B_PHONE);
    });

    it("an admin sees every call", async () => {
      const rows = await asUser(client, ids.adminUserId, (q) =>
        q.rows<{ id: string }>("select id from voice_calls order by created_at")
      );
      expect(rows.map((r) => r.id).sort()).toEqual([callOfA, callOfB].sort());
    });

    it("an agent cannot insert a call record directly", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          `insert into voice_calls (lead_id, agent_id, prospect_phone, agent_phone)
           values ($1, $2, '+19998887777', $3)`,
          [ids.leadOfA, ids.agentAAgentId, AGENT_A_PHONE]
        )
      );
      // 42501 = insufficient_privilege: there is no INSERT policy for agents.
      expect(code).toBe("42501");
    });

    it("an agent cannot point one of their own calls at another number", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update voice_calls set prospect_phone = '+19998887777' where id = $1", [
          callOfA,
        ])
      );
      expect(updated).toBe(0);

      const { rows } = await client.query(
        "select prospect_phone from voice_calls where id = $1",
        [callOfA]
      );
      expect(rows[0].prospect_phone).toBe(LEAD_A_PHONE);
    });

    it("an agent cannot rewrite a call's outcome", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count(
          "update voice_calls set status = 'completed', duration_seconds = 600 where id = $1",
          [callOfA]
        )
      );
      expect(updated).toBe(0);
    });

    it("an agent cannot delete call history", async () => {
      const deleted = await asUser(client, ids.agentAUserId, (q) =>
        q.count("delete from voice_calls where id = $1", [callOfA])
      );
      expect(deleted).toBe(0);
    });

    it("an agent cannot read another agent's bridge token", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select bridge_token from voice_calls where id = $1", [callOfB])
      );
      expect(rows).toHaveLength(0);
    });

    it("the server-controlled path can still update, which is how Twilio writes", async () => {
      // Same privileges the service-role client has in the status webhook.
      await client.query("begin");
      await client.query("set local role service_role");
      const res = await client.query(
        "update voice_calls set status = 'completed', duration_seconds = 42 where id = $1",
        [callOfA]
      );
      expect(res.rowCount).toBe(1);
      await client.query("rollback");
    });

    it("keeps a call visible to whoever owns the lead after a reassignment", async () => {
      await client.query("update public.leads set assigned_to = $1 where id = $2", [
        ids.agentBAgentId,
        ids.leadOfA,
      ]);
      try {
        const rows = await asUser(client, ids.agentBUserId, (q) =>
          q.rows("select id from voice_calls where id = $1", [callOfA])
        );
        expect(rows).toHaveLength(1);
      } finally {
        await client.query("update public.leads set assigned_to = $1 where id = $2", [
          ids.agentAAgentId,
          ids.leadOfA,
        ]);
      }
    });
  });

  // -------------------------------------------------------------------------
  // set_my_voice_phone
  // -------------------------------------------------------------------------

  describe("the canonical callback-number column", () => {
    it("lives on agent_profiles as a nullable text column", async () => {
      const { rows } = await client.query(`
        select data_type, is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'agent_profiles'
          and column_name = 'voice_phone'
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0].data_type).toBe("text");
      // Blank means "this agent has not set one", which is a real state and
      // must not need a sentinel value.
      expect(rows[0].is_nullable).toBe("YES");
    });

    it("is the only callback-number column in the schema", async () => {
      // Two places to store it is how Settings writes one and the dialer reads
      // the other. There is one column and there is no `profiles` table.
      const { rows } = await client.query(`
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and (column_name like '%callback%phone%'
               or column_name like '%callback_number%'
               or column_name = 'voice_phone')
      `);
      expect(rows).toEqual([
        { table_name: "agent_profiles", column_name: "voice_phone" },
      ]);

      const { rows: profiles } = await client.query(`
        select table_name from information_schema.tables
        where table_schema = 'public' and table_name = 'profiles'
      `);
      expect(profiles).toEqual([]);
    });

    it("only accepts E.164", async () => {
      await expect(
        client.query(
          "update agent_profiles set voice_phone = '8622984988' where id = $1",
          [ids.agentAAgentId]
        )
      ).rejects.toThrow(/agent_profiles_voice_phone_ck/);

      await expect(
        client.query(
          "update agent_profiles set voice_phone = '+0123456789' where id = $1",
          [ids.agentAAgentId]
        )
      ).rejects.toThrow(/agent_profiles_voice_phone_ck/);
    });

    it("an agent can read their own and nobody else's", async () => {
      const own = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select voice_phone from agent_profiles where id = $1", [
          ids.agentAAgentId,
        ])
      );
      expect(own).toHaveLength(1);
      expect(own[0].voice_phone).toBe(AGENT_A_PHONE);

      const teammate = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select voice_phone from agent_profiles where id = $1", [
          ids.agentBAgentId,
        ])
      );
      expect(teammate).toEqual([]);
    });

    it("an agent cannot write it directly, only through the function", async () => {
      const changed = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update agent_profiles set voice_phone = $2 where id = $1", [
          ids.agentBAgentId,
          "+15559998888",
        ])
      );
      expect(changed).toBe(0);

      const { rows } = await client.query(
        "select voice_phone from agent_profiles where id = $1",
        [ids.agentBAgentId]
      );
      expect(rows[0].voice_phone).toBe(AGENT_B_PHONE);
    });

    it("is not exposed through the teammate directory view", async () => {
      const { rows } = await client.query(`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'agent_directory'
      `);
      expect(rows.map((r) => r.column_name)).not.toContain("voice_phone");
    });
  });

  describe("set_my_voice_phone", () => {
    async function setAs(userId: string, phone: string | null, clear = false) {
      return asUserCommitting(userId, async () => {
        const { rows } = await client.query(
          "select public.set_my_voice_phone($1::text, $2::boolean) as result",
          [phone, clear]
        );
        return rows[0].result as Record<string, unknown>;
      });
    }

    async function storedFor(agentId: string): Promise<string | null> {
      const { rows } = await client.query(
        "select voice_phone from agent_profiles where id = $1",
        [agentId]
      );
      return rows[0].voice_phone as string | null;
    }

    it("sets and normalises the caller's own number", async () => {
      const result = await setAs(ids.agentAUserId, "(973) 555-7777");
      expect(result).toEqual({
        ok: true,
        cleared: false,
        voice_phone: "+19735557777",
      });

      expect(await storedFor(ids.agentAAgentId)).toBe("+19735557777");
    });

    it("returns the value it read back, not the value it computed", async () => {
      // `ok: true` has to mean the column holds this number. The function
      // re-selects after the UPDATE precisely so a write that did not land
      // cannot be reported as a save.
      const result = await setAs(ids.agentAUserId, "8622984988");
      expect(result.voice_phone).toBe(await storedFor(ids.agentAAgentId));
      expect(result.voice_phone).toBe("+18622984988");
    });

    it("refuses a blank number rather than treating it as an erase", async () => {
      // The production bug: Save pressed on an empty field wiped a saved
      // number and reported success. Erasing now has to be asked for.
      const result = await setAs(ids.agentAUserId, null);
      expect(result).toEqual({
        ok: false,
        reason: "blank_without_clear",
        voice_phone: AGENT_A_PHONE,
      });
      expect(await storedFor(ids.agentAAgentId)).toBe(AGENT_A_PHONE);

      const blank = await setAs(ids.agentAUserId, "   ");
      expect(blank.ok).toBe(false);
      expect(blank.reason).toBe("blank_without_clear");
      expect(await storedFor(ids.agentAAgentId)).toBe(AGENT_A_PHONE);
    });

    it("clears the number when the caller explicitly asks to", async () => {
      const result = await setAs(ids.agentAUserId, null, true);
      expect(result).toEqual({ ok: true, cleared: true, voice_phone: null });
      expect(await storedFor(ids.agentAAgentId)).toBeNull();
    });

    it("clears on a blank string with the clear flag too", async () => {
      await setAs(ids.agentAUserId, "", true);
      expect(await storedFor(ids.agentAAgentId)).toBeNull();
    });

    it("rejects a normalised number the column would refuse", async () => {
      // normalize_phone() will produce +0… from a pasted string; the CHECK
      // constraint will not accept it. Caught as a reason code rather than
      // surfacing as a constraint violation.
      const result = await setAs(ids.agentAUserId, "+0123456789");
      expect(result).toEqual({ ok: false, reason: "invalid_phone" });
      expect(await storedFor(ids.agentAAgentId)).toBe(AGENT_A_PHONE);
    });

    it("rejects a number it could not dial", async () => {
      const result = await setAs(ids.agentAUserId, "call me maybe");
      expect(result).toEqual({ ok: false, reason: "invalid_phone" });

      const { rows } = await client.query(
        "select voice_phone from agent_profiles where id = $1",
        [ids.agentAAgentId]
      );
      expect(rows[0].voice_phone).toBe(AGENT_A_PHONE);
    });

    it("touches only the caller's row", async () => {
      await setAs(ids.agentAUserId, "+19735557777");
      const { rows } = await client.query(
        "select voice_phone from agent_profiles where id = $1",
        [ids.agentBAgentId]
      );
      expect(rows[0].voice_phone).toBe(AGENT_B_PHONE);
    });

    it("takes no agent parameter, so it cannot be pointed at a teammate", async () => {
      const { rows } = await client.query(`
        select pg_get_function_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_my_voice_phone'
      `);
      // Two parameters: the number and whether erasing it was intended.
      // Neither of them names an agent.
      expect(rows[0].args).toBe("p_phone text, p_clear boolean DEFAULT false");
      expect(rows[0].args).not.toContain("agent");
    });

    it("does not open up the rest of the profile", async () => {
      // The function is the only agent write on agent_profiles. There is no
      // agent UPDATE policy at all, so a direct write matches nothing rather
      // than raising — the row is simply not there to update.
      const roleChanged = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update agent_profiles set role = 'admin' where id = $1", [
          ids.agentAAgentId,
        ])
      );
      expect(roleChanged).toBe(0);

      const rateChanged = await asUser(client, ids.agentAUserId, (q) =>
        q.count(
          "update agent_profiles set default_commission_rate_bps = 9999 where id = $1",
          [ids.agentAAgentId]
        )
      );
      expect(rateChanged).toBe(0);

      // And confirm from a privileged connection that nothing moved.
      const { rows } = await client.query(
        "select role, default_commission_rate_bps from agent_profiles where id = $1",
        [ids.agentAAgentId]
      );
      expect(rows[0].role).toBe("agent");
      expect(rows[0].default_commission_rate_bps).toBe(3000);
    });
  });

  // -------------------------------------------------------------------------
  // Schema guarantees
  // -------------------------------------------------------------------------

  describe("schema", () => {
    it("stores no recording or transcript", async () => {
      const { rows } = await client.query(`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'voice_calls'
      `);
      const columns = rows.map((r) => r.column_name as string);
      expect(columns.some((c) => /recording|transcript/.test(c))).toBe(false);
    });

    it("constrains agent_profiles.voice_phone to E.164", async () => {
      await expect(
        client.query("update agent_profiles set voice_phone = '8622984988' where id = $1", [
          ids.agentAAgentId,
        ])
      ).rejects.toThrow(/agent_profiles_voice_phone_ck/);
    });

    it("does not expose voice_phone through the teammate directory", async () => {
      const { rows } = await client.query(`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'agent_directory'
      `);
      expect(rows.map((r) => r.column_name)).toEqual(["id", "display_name", "is_active"]);
    });

    it("rejects a status outside the documented set", async () => {
      const call = await requestCallAs(ids.agentAUserId, ids.leadOfA);
      await expect(
        client.query("update voice_calls set status = 'answered' where id = $1", [
          call.call_id,
        ])
      ).rejects.toThrow(/voice_calls_status_check/);
    });

    it("has no write policy for agents at all", async () => {
      const { rows } = await client.query(`
        select cmd, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = 'voice_calls'
          and cmd in ('INSERT', 'UPDATE', 'DELETE')
      `);
      for (const row of rows) {
        const predicate = `${row.qual ?? ""}${row.with_check ?? ""}`;
        expect(predicate).toContain("is_admin");
      }
    });

    it("does not reference the revenue tables", async () => {
      const { rows } = await client.query(`
        select f.relname as target
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_class f on f.oid = c.confrelid
        where c.contype = 'f' and t.relname = 'voice_calls'
      `);
      expect(rows.map((r) => r.target).sort()).toEqual(["agent_profiles", "leads"]);
    });
  });
});
