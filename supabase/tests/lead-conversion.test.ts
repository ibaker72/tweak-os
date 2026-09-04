import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import {
  asUser,
  connect,
  connectAlso,
  hasTestDatabase,
  resetSchema,
  seed,
  type SeedIds,
} from "./helpers";

/**
 * Lead conversion must be a one-time transition.
 *
 * Before 00025 this function inserted an account and a deal unconditionally —
 * no conversion-state check, no lock, and no unique constraint on
 * accounts.lead_id. Two concurrent sessions both succeeded and the lead ended
 * up with 2 accounts, 2 deals and 2 'lead.converted' events. A double-click or
 * a browser retry after a timeout produced the same thing.
 *
 * The concurrency cases here use two real Postgres connections, because one
 * transaction cannot race itself and a single-connection test would pass
 * against the broken function.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

interface ConversionResult {
  status: "converted" | "already_converted";
  account_id: string;
  deal_id: string | null;
  commission_rate_bps: number | null;
  rate_basis: string | null;
  recurring_cap_months: number | null;
  credited_to: string | null;
}

describeDb("lead conversion is idempotent", () => {
  let client: Client;
  let other: Client;
  let third: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect("leadconversion");
    await resetSchema(client);
    ids = await seed(client);
    other = await connectAlso("leadconversion");
    third = await connectAlso("leadconversion");
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await other?.end();
    await third?.end();
  });

  beforeEach(async () => {
    // Revenue rows go; the seeded agents and leads stay. commission_entries is
    // append-only at the row level, so TRUNCATE is the only way to clear it.
    await client.query(`
      truncate commission_entries, payout_batches, payments,
               deal_milestones, deals, accounts
      restart identity cascade
    `);
    await client.query(`delete from attributions`);
    await client.query(`delete from activity_log where action = 'lead.converted'`);
    await client.query(
      `update leads set lifecycle_status = 'new' where id in ($1, $2)`,
      [ids.leadOfA, ids.leadOfB]
    );
  });

  /**
   * Call the RPC the way a request does: as the given user, on the `authenticated`
   * role, committing so the effect is visible to the other connection.
   */
  async function convert(
    c: Client,
    userId: string,
    leadId: string,
    overrides: { model?: "one_time" | "recurring"; cap?: number | null } = {}
  ): Promise<{ ok: true; out: ConversionResult } | { ok: false; code: string; message: string }> {
    await c.query("begin");
    try {
      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [userId]
      );
      await c.query("set local role authenticated");
      const { rows } = await c.query(
        `select public.convert_lead_to_account(
           $1, 'Acme HVAC', 'Acme build', 'rapid_build', $2, $3, $4, $5,
           null, null, null
         ) as out`,
        [
          leadId,
          overrides.model ?? "one_time",
          overrides.model === "recurring" ? 0 : 800_000,
          overrides.model === "recurring" ? 300_000 : 0,
          overrides.cap ?? null,
        ]
      );
      await c.query("commit");
      return { ok: true, out: rows[0].out as ConversionResult };
    } catch (err) {
      await c.query("rollback");
      const e = err as { code?: string; message: string };
      return { ok: false, code: e.code ?? "", message: e.message };
    }
  }

  const countOf = async (sql: string, params: unknown[] = []) => {
    const { rows } = await client.query(sql, params);
    return Number(rows[0].n);
  };

  const accountsFor = (leadId: string) =>
    countOf(`select count(*)::int n from accounts where lead_id = $1`, [leadId]);
  const dealsTotal = () => countOf(`select count(*)::int n from deals`);
  const conversionEvents = (leadId: string) =>
    countOf(
      `select count(*)::int n from activity_log
       where action = 'lead.converted' and entity_id = $1`,
      [leadId]
    );

  // -------------------------------------------------------------------------
  // 1-2. The ordinary path, and doing it twice.
  // -------------------------------------------------------------------------

  it("a single conversion creates one account and one draft deal", async () => {
    const res = await convert(client, ids.agentAUserId, ids.leadOfA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.out.status).toBe("converted");
    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);

    const { rows } = await client.query(
      `select status, closed_by_agent_id from deals where id = $1`,
      [res.out.deal_id]
    );
    expect(rows[0].status).toBe("draft");
    expect(rows[0].closed_by_agent_id).toBe(ids.agentAAgentId);
  });

  it("an immediate second conversion returns the same ids and writes nothing", async () => {
    const first = await convert(client, ids.agentAUserId, ids.leadOfA);
    const second = await convert(client, ids.agentAUserId, ids.leadOfA);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.out.status).toBe("converted");
    expect(second.out.status).toBe("already_converted");
    expect(second.out.account_id).toBe(first.out.account_id);
    expect(second.out.deal_id).toBe(first.out.deal_id);

    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);
  });

  it("a duplicate attempt is a success, not an error", async () => {
    await convert(client, ids.agentAUserId, ids.leadOfA);
    const again = await convert(client, ids.agentAUserId, ids.leadOfA);
    // The point of the contract: no 500, no unique-violation surfaced.
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.out.account_id).toBeTruthy();
    expect(again.out.deal_id).toBeTruthy();
  });

  it("carries the original rate and credit through the already_converted reply", async () => {
    const first = await convert(client, ids.agentAUserId, ids.leadOfA);
    const second = await convert(client, ids.agentAUserId, ids.leadOfA);
    if (!first.ok || !second.ok) throw new Error("conversion failed");

    expect(second.out.commission_rate_bps).toBe(first.out.commission_rate_bps);
    expect(second.out.credited_to).toBe(first.out.credited_to);
    expect(second.out.rate_basis).toBe(first.out.rate_basis);
  });

  // -------------------------------------------------------------------------
  // 3-5. Concurrency and retry. Two real connections.
  // -------------------------------------------------------------------------

  it("two simultaneous conversions on separate connections produce one account", async () => {
    const [a, b] = await Promise.all([
      convert(client, ids.agentAUserId, ids.leadOfA),
      convert(other, ids.agentAUserId, ids.leadOfA),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);

    // Both callers get a usable answer pointing at the same rows.
    expect(a.out.account_id).toBe(b.out.account_id);
    expect(a.out.deal_id).toBe(b.out.deal_id);

    // Exactly one of them did the work.
    const statuses = [a.out.status, b.out.status].sort();
    expect(statuses).toEqual(["already_converted", "converted"]);
  });

  it("an agent and an admin converting at the same moment produce one account", async () => {
    const [a, b] = await Promise.all([
      convert(client, ids.agentAUserId, ids.leadOfA),
      convert(other, ids.adminUserId, ids.leadOfA),
    ]);

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);
    expect(a.out.account_id).toBe(b.out.account_id);

    // Whichever won, the lead's owner is credited — never the admin.
    const { rows } = await client.query(
      `select owner_agent_id from accounts where lead_id = $1`,
      [ids.leadOfA]
    );
    expect(rows[0].owner_agent_id).toBe(ids.agentAAgentId);
  });

  it("five overlapping attempts still produce one account", async () => {
    // Two waves across three connections — one in flight per connection, so
    // these genuinely race rather than being queued by the driver.
    const wave1 = await Promise.all([
      convert(client, ids.agentAUserId, ids.leadOfA),
      convert(other, ids.agentAUserId, ids.leadOfA),
      convert(third, ids.agentAUserId, ids.leadOfA),
    ]);
    const wave2 = await Promise.all([
      convert(client, ids.agentAUserId, ids.leadOfA),
      convert(other, ids.agentAUserId, ids.leadOfA),
    ]);
    const results = [...wave1, ...wave2];

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);

    const converted = results.filter((r) => r.ok && r.out.status === "converted");
    expect(converted).toHaveLength(1);
  });

  it("three-way concurrent conversion writes one account and one event", async () => {
    const results = await Promise.all([
      convert(client, ids.agentAUserId, ids.leadOfA),
      convert(other, ids.adminUserId, ids.leadOfA),
      convert(third, ids.agentAUserId, ids.leadOfA),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);
    expect(await conversionEvents(ids.leadOfA)).toBe(1);

    const ids_ = results.map((r) => (r.ok ? r.out.account_id : null));
    expect(new Set(ids_).size).toBe(1);
  });

  it("a repeated identical request is already_converted, not a new row", async () => {
    await convert(client, ids.agentAUserId, ids.leadOfA);
    for (let i = 0; i < 3; i += 1) {
      const retry = await convert(client, ids.agentAUserId, ids.leadOfA);
      expect(retry.ok).toBe(true);
      if (retry.ok) expect(retry.out.status).toBe("already_converted");
    }
    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6-8. Authorisation, credit, and reassignment.
  // -------------------------------------------------------------------------

  it("agent B cannot convert agent A's lead, and creates nothing", async () => {
    const res = await convert(other, ids.agentBUserId, ids.leadOfA);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("42501");

    expect(await accountsFor(ids.leadOfA)).toBe(0);
    expect(await dealsTotal()).toBe(0);
    expect(await conversionEvents(ids.leadOfA)).toBe(0);
  });

  it("agent B cannot convert agent A's already-converted lead either", async () => {
    await convert(client, ids.agentAUserId, ids.leadOfA);
    const res = await convert(other, ids.agentBUserId, ids.leadOfA);

    // Authorisation is checked before conversion state is disclosed, so B
    // learns nothing about the lead — not even that it is converted.
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("42501");
    expect(await accountsFor(ids.leadOfA)).toBe(1);
  });

  it("an admin converting an agent's lead credits the agent, not the admin", async () => {
    const res = await convert(client, ids.adminUserId, ids.leadOfA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.out.credited_to).toBe(ids.agentAAgentId);

    const { rows } = await client.query(
      `select a.owner_agent_id, d.closed_by_agent_id
       from accounts a join deals d on d.account_id = a.id
       where a.lead_id = $1`,
      [ids.leadOfA]
    );
    expect(rows[0].owner_agent_id).toBe(ids.agentAAgentId);
    expect(rows[0].closed_by_agent_id).toBe(ids.agentAAgentId);
  });

  it("a reassigned lead credits the current assignee at conversion time", async () => {
    await client.query(`update leads set assigned_to = $1 where id = $2`, [
      ids.agentBAgentId,
      ids.leadOfA,
    ]);
    try {
      const res = await convert(other, ids.agentBUserId, ids.leadOfA);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.out.credited_to).toBe(ids.agentBAgentId);
    } finally {
      await client.query(`update leads set assigned_to = $1 where id = $2`, [
        ids.agentAAgentId,
        ids.leadOfA,
      ]);
    }
  });

  it("does not move credit when a second caller finds it already converted", async () => {
    // A converts. Then an admin retries. Credit must not follow the retrier.
    const first = await convert(client, ids.agentAUserId, ids.leadOfA);
    const admin = await convert(client, ids.adminUserId, ids.leadOfA);
    if (!first.ok || !admin.ok) throw new Error("conversion failed");

    expect(admin.out.status).toBe("already_converted");
    expect(admin.out.credited_to).toBe(ids.agentAAgentId);

    const { rows } = await client.query(
      `select owner_agent_id from accounts where lead_id = $1`,
      [ids.leadOfA]
    );
    expect(rows[0].owner_agent_id).toBe(ids.agentAAgentId);
  });

  // -------------------------------------------------------------------------
  // 9-11. Attribution, recovery, and later deals.
  // -------------------------------------------------------------------------

  it("resolves exactly one attribution, however many times it is called", async () => {
    await client.query(
      `insert into attributions (agent_id, lead_id, source, first_touch_at)
       values ($1, $2, 'self_sourced', now() - interval '2 days'),
              ($3, $2, 'inbound_assigned', now() - interval '1 day')`,
      [ids.agentAAgentId, ids.leadOfA, ids.agentBAgentId]
    );

    await convert(client, ids.agentAUserId, ids.leadOfA);
    await convert(client, ids.agentAUserId, ids.leadOfA);
    await convert(client, ids.agentAUserId, ids.leadOfA);

    const resolved = await countOf(
      `select count(*)::int n from attributions
       where lead_id = $1 and resolved_at is not null`,
      [ids.leadOfA]
    );
    expect(resolved).toBe(1);

    // And it is the earliest first touch that won, not the runner-up.
    const { rows } = await client.query(
      `select agent_id from attributions
       where lead_id = $1 and resolved_at is not null`,
      [ids.leadOfA]
    );
    expect(rows[0].agent_id).toBe(ids.agentAAgentId);
  });

  it("completes a conversion whose account exists but whose deal is missing", async () => {
    // The partial state a failed conversion would leave, built by hand: the
    // function itself commits or rolls back as one statement.
    const { rows } = await client.query(
      `insert into accounts (lead_id, company_name, owner_agent_id, status)
       values ($1, 'Half converted', $2, 'active') returning id`,
      [ids.leadOfA, ids.agentAAgentId]
    );
    const orphanAccount = rows[0].id as string;

    const res = await convert(client, ids.agentAUserId, ids.leadOfA);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Recovered into the existing account rather than creating a second one.
    expect(res.out.status).toBe("converted");
    expect(res.out.account_id).toBe(orphanAccount);
    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);
  });

  it("recognises an account created outside the lock", async () => {
    // The unique-violation backstop: an account inserted directly, then a
    // conversion attempt. It must return the canonical rows, not raise.
    await client.query(
      `insert into accounts (lead_id, company_name, owner_agent_id, status)
       values ($1, 'Direct insert', $2, 'active')`,
      [ids.leadOfA, ids.agentAAgentId]
    );
    await client.query(
      `insert into deals (account_id, name, deal_type, commission_model,
         contract_value_cents, status, closed_by_agent_id, signed_at, commission_rate_bps)
       select id, 'Pre-existing', 'rapid_build', 'one_time', 500000, 'signed', $1, now(), 3000
       from accounts where lead_id = $2`,
      [ids.agentAAgentId, ids.leadOfA]
    );

    const res = await convert(client, ids.agentAUserId, ids.leadOfA);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.out.status).toBe("already_converted");
    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await dealsTotal()).toBe(1);
  });

  it("still allows more deals on the account after conversion", async () => {
    const res = await convert(client, ids.agentAUserId, ids.leadOfA);
    if (!res.ok) throw new Error("conversion failed");

    await client.query(
      `insert into deals (account_id, name, deal_type, commission_model,
         contract_value_cents, status, closed_by_agent_id, signed_at, commission_rate_bps)
       values ($1, 'Second engagement', 'growth_retainer', 'one_time',
               450000, 'signed', $2, now(), 3000)`,
      [res.out.account_id, ids.agentAAgentId]
    );
    expect(await dealsTotal()).toBe(2);

    // A later deal must not make the lead look unconverted, and must not let a
    // retry create a second account.
    const again = await convert(client, ids.agentAUserId, ids.leadOfA);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.out.status).toBe("already_converted");
      // The initial deal is still the one reported, not the newer one.
      expect(again.out.deal_id).toBe(res.out.deal_id);
    }
    expect(await accountsFor(ids.leadOfA)).toBe(1);
  });

  it("leaves a different lead free to convert to its own account", async () => {
    await convert(client, ids.agentAUserId, ids.leadOfA);
    const b = await convert(other, ids.agentBUserId, ids.leadOfB);

    expect(b.ok).toBe(true);
    if (b.ok) expect(b.out.status).toBe("converted");
    expect(await accountsFor(ids.leadOfA)).toBe(1);
    expect(await accountsFor(ids.leadOfB)).toBe(1);
    expect(await dealsTotal()).toBe(2);
  });

  it("allows many accounts that have no sourcing lead", async () => {
    // The unique index is partial: NULL lead_id is "no lead", not a duplicate.
    await client.query(
      `insert into accounts (lead_id, company_name, status)
       values (null, 'Direct inbound one', 'active'),
              (null, 'Direct inbound two', 'active')`
    );
    expect(await countOf(`select count(*)::int n from accounts where lead_id is null`)).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 12. The activity trail.
  // -------------------------------------------------------------------------

  it("writes exactly one conversion event for one economic conversion", async () => {
    await convert(client, ids.agentAUserId, ids.leadOfA);
    await convert(client, ids.agentAUserId, ids.leadOfA);
    await convert(client, ids.agentAUserId, ids.leadOfA);

    expect(await conversionEvents(ids.leadOfA)).toBe(1);
  });

  it("writes one conversion event under concurrency too", async () => {
    await Promise.all([
      convert(client, ids.agentAUserId, ids.leadOfA),
      convert(other, ids.agentAUserId, ids.leadOfA),
    ]);
    expect(await conversionEvents(ids.leadOfA)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // The guarantee itself, and the deactivated-agent boundary.
  // -------------------------------------------------------------------------

  it("the database refuses a second account for one lead outright", async () => {
    await convert(client, ids.agentAUserId, ids.leadOfA);

    // Bypassing the function entirely: the constraint is the real guarantee.
    await expect(
      client.query(
        `insert into accounts (lead_id, company_name, owner_agent_id, status)
         values ($1, 'Sneaky second', $2, 'active')`,
        [ids.leadOfA, ids.agentAAgentId]
      )
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("a deactivated agent cannot convert, even with a live session", async () => {
    const res = await convert(client, ids.inactiveUserId, ids.leadOfA);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("42501");
    expect(await accountsFor(ids.leadOfA)).toBe(0);
    expect(await dealsTotal()).toBe(0);
  });

  it("a deactivated agent is refused even for a lead assigned to them", async () => {
    const { rows } = await client.query(
      `select id from agent_profiles where user_id = $1`,
      [ids.inactiveUserId]
    );
    const inactiveAgentId = rows[0].id as string;

    await client.query(`update leads set assigned_to = $1 where id = $2`, [
      inactiveAgentId,
      ids.leadOfA,
    ]);
    try {
      const res = await convert(client, ids.inactiveUserId, ids.leadOfA);
      expect(res.ok).toBe(false);
      expect(await accountsFor(ids.leadOfA)).toBe(0);
    } finally {
      await client.query(`update leads set assigned_to = $1 where id = $2`, [
        ids.agentAAgentId,
        ids.leadOfA,
      ]);
    }
  });

  it("an agent still cannot insert an account or deal directly", async () => {
    const accountCode = await asUser(client, ids.agentAUserId, (q) =>
      q.errorCode(
        `insert into accounts (lead_id, company_name, owner_agent_id, status)
         values ($1, 'Direct', $2, 'active')`,
        [ids.leadOfA, ids.agentAAgentId]
      )
    );
    expect(accountCode).toBe("42501");
  });
});
