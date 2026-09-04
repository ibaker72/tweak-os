import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { connect, connectAlso, hasTestDatabase, resetSchema, seed, type SeedIds } from "./helpers";
import { accrueDeal } from "../../src/lib/commissions/accrue";
import { makePgSupabaseShim } from "./pg-shim";

/**
 * The onboarding rehearsal.
 *
 * Every other DB suite proves one mechanism in isolation. This one walks the
 * whole path two real partners will walk on their first day, in order, on one
 * database, and asserts the things that would actually cost money or trust if
 * they were wrong: that a second partner cannot take the first one's lead, that
 * credit follows the sourcing agent rather than whoever clicked last, and that
 * deactivating someone stops them dead.
 *
 * It is deliberately one long narrative rather than isolated cases. The bugs
 * this is meant to catch are the ones that only appear when steps run in
 * sequence against state the previous step left behind.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("onboarding smoke: agent A and agent B", () => {
  let client: Client;
  let other: Client;
  let ids: SeedIds;
  let db: ReturnType<typeof makePgSupabaseShim>;

  beforeAll(async () => {
    client = await connect("onboardingsmoke");
    await resetSchema(client);
    ids = await seed(client);
    other = await connectAlso("onboardingsmoke");
    db = makePgSupabaseShim(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await other?.end();
  });

  /** Run a statement as a signed-in user, committing. */
  async function asCommitted<T>(
    c: Client,
    userId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    await c.query("begin");
    try {
      await c.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [userId]
      );
      await c.query("set local role authenticated");
      const out = await fn();
      await c.query("commit");
      return out;
    } catch (err) {
      await c.query("rollback");
      throw err;
    }
  }

  async function importAs(c: Client, userId: string, rows: unknown[], filename: string) {
    return asCommitted(c, userId, async () => {
      const { rows: out } = await c.query<{ result: Record<string, number | string> }>(
        `select public.import_agent_leads($1::jsonb, $2::text) as result`,
        [JSON.stringify(rows), filename]
      );
      return out[0].result;
    });
  }

  function sheet(n: number, offset = 0) {
    return Array.from({ length: n }, (_, i) => {
      const k = i + offset + 1;
      return {
        business_name: `Partner Co ${k}`,
        city: "Newark",
        state: "NJ",
        email: `owner${k}@partnerco${k}.com`,
        website: `https://partnerco${k}.com`,
        phone: `555-01${String(k).padStart(2, "0")}`,
        niche: "HVAC",
      };
    });
  }

  const count = async (sql: string, params: unknown[] = []) => {
    const { rows } = await client.query(sql, params);
    return Number(rows[0].n);
  };

  // State carried between steps — this suite is a narrative, not a set of
  // independent cases.
  let firstLeadId: string;
  let accountId: string;
  let dealId: string;

  // -------------------------------------------------------------------------
  // Agent A: import, dedupe, propose, convert.
  // -------------------------------------------------------------------------

  it("A imports 7 leads and is credited for all of them", async () => {
    const result = await importAs(client, ids.agentAUserId, sheet(7), "partners.csv");

    expect(result.imported_rows).toBe(7);
    expect(result.credited_to).toBe(ids.agentAAgentId);

    expect(
      await count(
        `select count(*)::int n from leads where assigned_to = $1 and source = 'self_sourced'`,
        [ids.agentAAgentId]
      )
    ).toBe(7);

    // One self-sourced attribution per lead — this is what sets A's rate later.
    expect(
      await count(
        `select count(*)::int n from attributions
         where agent_id = $1 and source = 'self_sourced'`,
        [ids.agentAAgentId]
      )
    ).toBe(7);
  });

  it("A re-uploads the same sheet plus 7 more: only the new ones land", async () => {
    const result = await importAs(
      client,
      ids.agentAUserId,
      [...sheet(7), ...sheet(7, 7)],
      "partners-v2.csv"
    );

    expect(result.imported_rows).toBe(7);
    expect(result.skipped_duplicates).toBe(7);

    expect(
      await count(`select count(*)::int n from leads where business_name like 'Partner Co %'`)
    ).toBe(14);

    // No second attribution for the seven that were skipped.
    expect(
      await count(
        `select count(*)::int n from attributions where agent_id = $1`,
        [ids.agentAAgentId]
      )
    ).toBe(14);
  });

  it("A writes a proposal against one of their leads", async () => {
    const { rows } = await client.query(
      `select id from leads where business_name = 'Partner Co 1'`
    );
    firstLeadId = rows[0].id as string;

    await asCommitted(client, ids.agentAUserId, async () => {
      await client.query(
        `insert into proposals (client_name, created_by, lead_id, total_one_time, status)
         values ('Partner Co 1', $1, $2, 8500, 'saved')`,
        [ids.agentAAgentId, firstLeadId]
      );
    });

    expect(
      await count(`select count(*)::int n from proposals where lead_id = $1`, [firstLeadId])
    ).toBe(1);
  });

  it("A converts that lead into an account and a draft deal", async () => {
    const out = await asCommitted(client, ids.agentAUserId, async () => {
      const { rows } = await client.query(
        `select public.convert_lead_to_account(
           $1,'Partner Co 1','Partner Co 1 build','rapid_build','one_time',
           850000,0,null,null,null,null) as out`,
        [firstLeadId]
      );
      return rows[0].out as Record<string, string>;
    });

    expect(out.status).toBe("converted");
    expect(out.credited_to).toBe(ids.agentAAgentId);
    accountId = out.account_id;
    dealId = out.deal_id;

    // Self-sourced attribution means A keeps the full rate, not the inbound one.
    expect(out.rate_basis).toBe("self_sourced");

    const { rows } = await client.query(
      `select status, closed_by_agent_id, commission_rate_bps from deals where id = $1`,
      [dealId]
    );
    expect(rows[0].status).toBe("draft");
    expect(rows[0].closed_by_agent_id).toBe(ids.agentAAgentId);

    // The proposal still points at the lead the account came from.
    expect(
      await count(`select count(*)::int n from proposals where lead_id = $1`, [firstLeadId])
    ).toBe(1);
  });

  it("A double-clicking Convert changes nothing", async () => {
    const out = await asCommitted(client, ids.agentAUserId, async () => {
      const { rows } = await client.query(
        `select public.convert_lead_to_account(
           $1,'Partner Co 1','Partner Co 1 build','rapid_build','one_time',
           850000,0,null,null,null,null) as out`,
        [firstLeadId]
      );
      return rows[0].out as Record<string, string>;
    });

    expect(out.status).toBe("already_converted");
    expect(out.account_id).toBe(accountId);
    expect(out.deal_id).toBe(dealId);
    expect(await count(`select count(*)::int n from accounts`)).toBe(1);
    expect(await count(`select count(*)::int n from deals`)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Agent B: the partner who tries to take A's work.
  // -------------------------------------------------------------------------

  it("B uploading A's sheet gets nothing and steals no credit", async () => {
    const result = await importAs(other, ids.agentBUserId, sheet(7), "stolen.csv");

    expect(result.imported_rows).toBe(0);
    expect(result.skipped_duplicates).toBe(7);

    // Still A's leads, still A's attributions, and B has none.
    expect(
      await count(`select count(*)::int n from leads where assigned_to = $1`, [
        ids.agentBAgentId,
      ])
    ).toBe(1); // only the seeded leadOfB
    expect(
      await count(`select count(*)::int n from attributions where agent_id = $1`, [
        ids.agentBAgentId,
      ])
    ).toBe(0);
    expect(
      await count(`select count(*)::int n from leads where assigned_to = $1`, [
        ids.agentAAgentId,
      ])
    ).toBe(15); // 14 imported + the seeded leadOfA
  });

  it("B cannot see A's leads at all", async () => {
    const visible = await asCommitted(other, ids.agentBUserId, async () => {
      const { rows } = await other.query(
        `select count(*)::int n from leads where business_name like 'Partner Co %'`
      );
      return Number(rows[0].n);
    });
    expect(visible).toBe(0);
  });

  it("B calling the conversion RPC directly on A's lead is refused", async () => {
    await expect(
      asCommitted(other, ids.agentBUserId, async () => {
        await other.query(
          `select public.convert_lead_to_account(
             $1,'Hijack','Hijack deal','rapid_build','one_time',
             100000,0,null,null,null,null)`,
          [firstLeadId]
        );
      })
    ).rejects.toMatchObject({ code: "42501" });

    // And nothing moved.
    expect(await count(`select count(*)::int n from accounts`)).toBe(1);
    const { rows } = await client.query(
      `select owner_agent_id from accounts where id = $1`,
      [accountId]
    );
    expect(rows[0].owner_agent_id).toBe(ids.agentAAgentId);
  });

  it("B cannot attach a proposal to A's lead through the visibility check", async () => {
    // What canAttachLead() reads: no visible lead, no attach.
    const visible = await asCommitted(other, ids.agentBUserId, async () => {
      const { rows } = await other.query(`select id from leads where id = $1`, [firstLeadId]);
      return rows.length;
    });
    expect(visible).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Admin: sign the deal, take the money, check who gets paid.
  // -------------------------------------------------------------------------

  it("an admin signs the deal and a cleared payment accrues to A, not the admin", async () => {
    await client.query(
      `update deals set status = 'signed', signed_at = now() where id = $1`,
      [dealId]
    );
    await client.query(
      `insert into payments (deal_id, amount_cents, received_at, cleared_at)
       values ($1, 850000, now(), now())`,
      [dealId]
    );

    const result = await accrueDeal(db as never, dealId);
    expect(result.errors).toEqual([]);
    expect(result.entriesWritten).toBe(1);

    const { rows } = await client.query(
      `select agent_id, amount_cents, rate_bps_applied
       from commission_entries where deal_id = $1`,
      [dealId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_id).toBe(ids.agentAAgentId);
    // 30% of $8,500 is $2,550, to the cent.
    expect(Number(rows[0].amount_cents)).toBe(255_000);
    expect(rows[0].rate_bps_applied).toBe(3000);
  });

  it("B cannot see a cent of it", async () => {
    const seen = await asCommitted(other, ids.agentBUserId, async () => {
      const { rows } = await other.query(
        `select coalesce(sum(amount_cents), 0)::bigint t from commission_entries`
      );
      return Number(rows[0].t);
    });
    expect(seen).toBe(0);
  });

  it("the admin can see the attribution and the ledger", async () => {
    const seen = await asCommitted(client, ids.adminUserId, async () => {
      const { rows } = await client.query(
        `select
           (select count(*)::int from attributions where lead_id = $1) a,
           (select count(*)::int from commission_entries) c,
           (select count(*)::int from accounts) ac`,
        [firstLeadId]
      );
      return rows[0];
    });
    expect(Number(seen.a)).toBe(1);
    expect(Number(seen.c)).toBe(1);
    expect(Number(seen.ac)).toBe(1);
  });

  it("the resolved attribution still names A after everything above", async () => {
    const { rows } = await client.query(
      `select agent_id, source, resolved_at from attributions where lead_id = $1`,
      [firstLeadId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_id).toBe(ids.agentAAgentId);
    expect(rows[0].source).toBe("self_sourced");
    expect(rows[0].resolved_at).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Deactivation: the stale session.
  // -------------------------------------------------------------------------

  describe("after the admin deactivates agent A", () => {
    beforeAll(async () => {
      await client.query(`update agent_profiles set is_active = false where id = $1`, [
        ids.agentAAgentId,
      ]);
    });

    afterAll(async () => {
      await client.query(`update agent_profiles set is_active = true where id = $1`, [
        ids.agentAAgentId,
      ]);
    });

    it("A's still-valid session reads no leads", async () => {
      const seen = await asCommitted(client, ids.agentAUserId, async () => {
        const { rows } = await client.query(`select count(*)::int n from leads`);
        return Number(rows[0].n);
      });
      expect(seen).toBe(0);
    });

    it("A cannot convert another lead", async () => {
      const { rows } = await client.query(
        `select id from leads where business_name = 'Partner Co 2'`
      );
      await expect(
        asCommitted(client, ids.agentAUserId, async () => {
          await client.query(
            `select public.convert_lead_to_account(
               $1,'Partner Co 2','x','rapid_build','one_time',100000,0,null,null,null,null)`,
            [rows[0].id]
          );
        })
      ).rejects.toMatchObject({ code: "42501" });

      expect(await count(`select count(*)::int n from accounts`)).toBe(1);
    });

    it("A cannot import more leads", async () => {
      await expect(
        importAs(client, ids.agentAUserId, sheet(1, 99), "after-deactivation.csv")
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("A cannot request a voice call", async () => {
      await client.query(`update agent_profiles set voice_phone = '+15550000001' where id = $1`, [
        ids.agentAAgentId,
      ]);
      await expect(
        asCommitted(client, ids.agentAUserId, async () => {
          await client.query(`select public.request_voice_call($1)`, [firstLeadId]);
        })
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("A cannot set a callback number", async () => {
      await expect(
        asCommitted(client, ids.agentAUserId, async () => {
          await client.query(`select public.set_my_voice_phone($1, false)`, ["+15559998888"]);
        })
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("A cannot create a proposal", async () => {
      const inserted = await asCommitted(client, ids.agentAUserId, async () => {
        const res = await client.query(
          `insert into proposals (client_name, created_by, lead_id)
           select 'Ghost', $1, $2
           where exists (select 1 from leads where id = $2)`,
          [ids.agentAAgentId, firstLeadId]
        );
        return res.rowCount ?? 0;
      });
      // RLS hides the lead, so the guarded insert writes nothing.
      expect(inserted).toBe(0);
    });

    it("A cannot log SMS against their former lead", async () => {
      const inserted = await asCommitted(client, ids.agentAUserId, async () => {
        const res = await client.query(
          `insert into sms_messages (lead_id, direction, body, status)
           select $1, 'outbound', 'still here', 'queued'
           where exists (select 1 from leads where id = $1)`,
          [firstLeadId]
        );
        return res.rowCount ?? 0;
      });
      expect(inserted).toBe(0);
    });

    it("A's commission already earned is untouched", async () => {
      // Deactivation removes access, not money that was already earned.
      const { rows } = await client.query(
        `select coalesce(sum(amount_cents), 0)::bigint t
         from commission_entries where agent_id = $1`,
        [ids.agentAAgentId]
      );
      expect(Number(rows[0].t)).toBe(255_000);
    });
  });
});
