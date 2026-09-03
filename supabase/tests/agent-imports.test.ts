import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import { asUser, connect, hasTestDatabase, resetSchema, seed, type SeedIds } from "./helpers";

/**
 * Agents source their own leads and import them. The claim under test is that
 * this happens without Phase 1's lead-creation block being weakened:
 *
 *   * agents still have no INSERT on `leads` or `attributions`;
 *   * public.import_agent_leads() is the only way in, and it takes the
 *     crediting agent from the JWT — there is no parameter to forge;
 *   * every imported lead is assigned to the caller and carries a matching
 *     'self_sourced' attribution, which is what Phase 5's rate rule reads;
 *   * the admin importer is unaffected.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("agent self-sourced imports", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect("agentimports");
    await resetSchema(client);
    ids = await seed(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    // Leave the seeded leads in place — they are what the duplicate checks and
    // the ownership assertions are measured against — but clear everything the
    // previous test imported.
    await client.query(`
      delete from public.attributions;
      delete from public.activity_log;
      delete from public.import_jobs;
      delete from public.leads where source = 'self_sourced';
    `);
  });

  /**
   * Import as `userId`, committing.
   *
   * asUser() rolls back, which is right for read scoping and useless here: the
   * whole point is the rows the function writes, and they have to survive to
   * be inspected. `set local role` unwinds at commit, so the connection is
   * clean afterwards.
   */
  async function importAs(
    userId: string,
    rows: Record<string, unknown>[],
    filename = "marys-sheet.csv"
  ): Promise<Record<string, unknown>> {
    await client.query("begin");
    try {
      await client.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [userId]
      );
      await client.query("set local role authenticated");
      const { rows: out } = await client.query<{ result: Record<string, unknown> }>(
        `select public.import_agent_leads($1::jsonb, $2::text) as result`,
        [JSON.stringify(rows), filename]
      );
      await client.query("commit");
      return out[0].result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  const marysRow = {
    business_name: "Rockstar Beauty",
    city: "Newark",
    state: "NJ",
    contact_name: "Dana Reed",
    email: "dana@rockstar.com",
    website: "https://rockstar.com",
    phone: "555-0100",
    notes: "Met at expo",
    niche: "Salon",
  };

  describe("ownership", () => {
    it("assigns every imported lead to the importing agent", async () => {
      const result = await importAs(ids.agentAUserId, [marysRow]);
      expect(result.imported_rows).toBe(1);
      expect(result.credited_to).toBe(ids.agentAAgentId);

      const { rows } = await client.query(
        `select assigned_to, assigned_at, business_name, contact_name, manual_notes,
                niche, city, state, source
         from public.leads where business_name = 'Rockstar Beauty'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].assigned_to).toBe(ids.agentAAgentId);
      expect(rows[0].assigned_at).not.toBeNull();
      expect(rows[0].contact_name).toBe("Dana Reed");
      expect(rows[0].manual_notes).toBe("Met at expo");
      expect(rows[0].niche).toBe("Salon");
      expect(rows[0].source).toBe("self_sourced");
    });

    it("falls back to the industry key when niche is blank", async () => {
      await importAs(ids.agentAUserId, [
        { business_name: "Niche Co", state: "NJ", niche: "", industry: "Roofing" },
      ]);
      const { rows } = await client.query(
        `select niche from public.leads where business_name = 'Niche Co'`
      );
      expect(rows[0].niche).toBe("Roofing");
    });

    it("credits the caller, so two agents importing get their own leads", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "A Co", state: "NJ" }]);
      await importAs(ids.agentBUserId, [{ business_name: "B Co", state: "NJ" }]);

      const { rows } = await client.query(
        `select business_name, assigned_to from public.leads
         where business_name in ('A Co', 'B Co') order by business_name`
      );
      expect(rows).toEqual([
        { business_name: "A Co", assigned_to: ids.agentAAgentId },
        { business_name: "B Co", assigned_to: ids.agentBAgentId },
      ]);
    });

    it("ignores an assigned_to smuggled into the payload", async () => {
      await importAs(ids.agentAUserId, [
        { business_name: "Forged Co", state: "NJ", assigned_to: ids.agentBAgentId },
      ]);

      const { rows } = await client.query(
        `select assigned_to from public.leads where business_name = 'Forged Co'`
      );
      expect(rows[0].assigned_to).toBe(ids.agentAAgentId);
    });

    it("ignores an agent_id smuggled into the payload", async () => {
      await importAs(ids.agentAUserId, [
        { business_name: "Forged Two", state: "NJ", agent_id: ids.agentBAgentId },
      ]);

      const { rows } = await client.query(
        `select l.assigned_to, a.agent_id
         from public.leads l join public.attributions a on a.lead_id = l.id
         where l.business_name = 'Forged Two'`
      );
      expect(rows[0].assigned_to).toBe(ids.agentAAgentId);
      expect(rows[0].agent_id).toBe(ids.agentAAgentId);
    });

    it("has no agent parameter at all, so there is nothing to point elsewhere", async () => {
      const { rows } = await client.query<{ args: string; names: string[] }>(
        `select pg_get_function_arguments(p.oid) as args, p.proargnames as names
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'import_agent_leads'`
      );
      expect(rows).toHaveLength(1);
      // p_parse_failures is a display-only counter for the import job. Note
      // what is absent: no parameter names an agent, so there is no uuid a
      // client could pass to import onto someone else.
      expect(rows[0].args).toBe(
        "p_rows jsonb, p_filename text DEFAULT 'agent-import.csv'::text, " +
          "p_parse_failures integer DEFAULT 0"
      );
      expect(rows[0].names.filter((n) => /agent|assign|user|credit/i.test(n))).toEqual([]);
    });
  });

  describe("attribution", () => {
    it("writes a self_sourced attribution for every imported lead", async () => {
      await importAs(ids.agentAUserId, [marysRow]);

      const { rows } = await client.query(
        `select a.agent_id, a.source, a.first_touch_at, a.expires_at,
                a.is_override, a.resolved_at
         from public.attributions a
         join public.leads l on l.id = a.lead_id
         where l.business_name = 'Rockstar Beauty'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].agent_id).toBe(ids.agentAAgentId);
      expect(rows[0].source).toBe("self_sourced");
      expect(rows[0].is_override).toBe(false);
      expect(rows[0].resolved_at).toBeNull();
    });

    it("applies the standard 90-day expiry rather than anything client-supplied", async () => {
      await importAs(ids.agentAUserId, [
        {
          business_name: "Expiry Co",
          state: "NJ",
          // All ignored: expiry comes from the attributions trigger.
          expires_at: "2099-01-01T00:00:00Z",
          first_touch_at: "2000-01-01T00:00:00Z",
        },
      ]);

      const { rows } = await client.query<{ window_days: string }>(
        `select extract(day from (a.expires_at - a.first_touch_at))::text as window_days
         from public.attributions a
         join public.leads l on l.id = a.lead_id
         where l.business_name = 'Expiry Co'`
      );
      expect(rows[0].window_days).toBe("90");

      const { rows: touched } = await client.query<{ recent: boolean }>(
        `select a.first_touch_at > now() - interval '1 minute' as recent
         from public.attributions a
         join public.leads l on l.id = a.lead_id
         where l.business_name = 'Expiry Co'`
      );
      expect(touched[0].recent).toBe(true);
    });

    it("ignores a source or override the payload tries to set", async () => {
      await importAs(ids.agentAUserId, [
        {
          business_name: "Override Co",
          state: "NJ",
          source: "inbound_assigned",
          is_override: true,
          override_reason: "because I said so",
        },
      ]);

      const { rows } = await client.query(
        `select a.source, a.is_override, a.override_reason, l.source as lead_source
         from public.attributions a
         join public.leads l on l.id = a.lead_id
         where l.business_name = 'Override Co'`
      );
      expect(rows[0].source).toBe("self_sourced");
      expect(rows[0].is_override).toBe(false);
      expect(rows[0].override_reason).toBeNull();
      expect(rows[0].lead_source).toBe("self_sourced");
    });

    it("never writes an inbound_assigned attribution, which is what cuts the rate", async () => {
      // Phase 5 only drops an agent to the inbound rate when an explicit
      // inbound_assigned attribution exists. A self-sourced import must not
      // create one under any payload.
      await importAs(ids.agentAUserId, [
        { business_name: "Rate Co", state: "NJ", source: "inbound_assigned" },
      ]);

      const { rows } = await client.query(
        `select count(*)::int as n from public.attributions where source = 'inbound_assigned'`
      );
      expect(rows[0].n).toBe(0);
    });

    it("an agent still cannot write an attribution naming a teammate", async () => {
      await asUser(client, ids.agentAUserId, async (q) => {
        const code = await q.errorCode(
          `insert into public.attributions (agent_id, lead_id, source)
           values ($1, $2, 'self_sourced')`,
          [ids.agentBAgentId, ids.leadOfB]
        );
        expect(code).toBe("42501");
      });
    });

    it("an agent cannot even write an attribution naming themselves", async () => {
      await asUser(client, ids.agentAUserId, async (q) => {
        const code = await q.errorCode(
          `insert into public.attributions (agent_id, lead_id, source)
           values ($1, $2, 'self_sourced')`,
          [ids.agentAAgentId, ids.leadOfA]
        );
        expect(code).toBe("42501");
      });
    });
  });

  describe("duplicate detection", () => {
    it("skips a row whose external_id already exists", async () => {
      await importAs(ids.agentAUserId, [
        { business_name: "Ext Co", state: "NJ", external_id: "NJ-0001" },
      ]);
      const second = await importAs(ids.agentAUserId, [
        { business_name: "Different Name", state: "PA", external_id: "NJ-0001" },
      ]);

      expect(second.imported_rows).toBe(0);
      expect(second.skipped_duplicates).toBe(1);
    });

    it("matches external_id case-insensitively", async () => {
      await importAs(ids.agentAUserId, [
        { business_name: "Ext Co", state: "NJ", external_id: "nj-0002" },
      ]);
      const second = await importAs(ids.agentAUserId, [
        { business_name: "Ext Co Two", state: "NJ", external_id: "NJ-0002" },
      ]);
      expect(second.skipped_duplicates).toBe(1);
    });

    it("falls back to business_name plus state", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "Dupe Co", state: "NJ" }]);
      const second = await importAs(ids.agentAUserId, [
        { business_name: "dupe co", state: "nj" },
      ]);

      expect(second.imported_rows).toBe(0);
      expect(second.skipped_duplicates).toBe(1);
    });

    it("treats the same name in a different state as a different business", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "Multi Co", state: "NJ" }]);
      const second = await importAs(ids.agentAUserId, [
        { business_name: "Multi Co", state: "PA" },
      ]);
      expect(second.imported_rows).toBe(1);
    });

    it("dedupes against leads the agent cannot see, so two agents cannot both claim one", async () => {
      // Seeded 'Lead of B' belongs to agent B and is invisible to agent A
      // under RLS. Importing it anyway would create two credit claims on one
      // business, which is exactly the ambiguity this is meant to prevent.
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Lead of B" },
      ]);
      expect(result.imported_rows).toBe(0);
      expect(result.skipped_duplicates).toBe(1);
    });

    it("dedupes within one file", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Twice Co", state: "NJ" },
        { business_name: "Twice Co", state: "NJ" },
      ]);
      expect(result.imported_rows).toBe(1);
      expect(result.skipped_duplicates).toBe(1);
    });
  });

  describe("reporting", () => {
    it("counts imported, duplicate, invalid and failed rows separately", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "Seen Co", state: "NJ" }]);

      const result = await importAs(ids.agentAUserId, [
        { business_name: "Fresh Co", state: "NJ" },
        { business_name: "Seen Co", state: "NJ" },
        { business_name: "   " },
      ]);

      expect(result.total_rows).toBe(3);
      expect(result.imported_rows).toBe(1);
      expect(result.skipped_duplicates).toBe(1);
      // A row the sheet's author can fix is `invalid`; `failed` is reserved for
      // a write that blew up on our side. Merging them into one counter is what
      // made the old summary unactionable.
      expect(result.invalid_rows).toBe(1);
      expect(result.failed_rows).toBe(0);
      expect((result.failures as { message: string }[])[0].message).toMatch(
        /business name is required/i
      );
    });

    it("folds parser-rejected rows into the job's totals", async () => {
      // The route parses the CSV and only sends rows that validated. Without
      // this the import job would claim a smaller file than the agent
      // uploaded, and imported + skipped + failed would not add up.
      await client.query("begin");
      try {
        await client.query(
          `select set_config('request.jwt.claims',
             json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
          [ids.agentAUserId]
        );
        await client.query("set local role authenticated");
        const { rows } = await client.query<{ result: Record<string, number> }>(
          `select public.import_agent_leads($1::jsonb, 'partial.csv', 2) as result`,
          [JSON.stringify([{ business_name: "Parsed Co", state: "NJ" }])]
        );
        await client.query("commit");

        const result = rows[0].result;
        expect(result.total_rows).toBe(3);
        expect(result.imported_rows).toBe(1);
        expect(result.skipped_duplicates).toBe(0);
        expect(result.invalid_rows).toBe(2);
        expect(result.failed_rows).toBe(0);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }

      const { rows: jobs } = await client.query(
        `select total_rows, imported_rows, skipped_rows, invalid_rows, failed_rows
         from public.import_jobs where filename = 'partial.csv'`
      );
      expect(jobs[0]).toEqual({
        total_rows: 3,
        imported_rows: 1,
        skipped_rows: 0,
        invalid_rows: 2,
        failed_rows: 0,
      });
    });

    it("records an import job owned by the agent", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "Job Co", state: "NJ" }], "sheet.csv");

      const { rows } = await client.query(
        `select filename, total_rows, imported_rows, skipped_rows, failed_rows,
                status, created_by, source
         from public.import_jobs`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].filename).toBe("sheet.csv");
      expect(rows[0].status).toBe("completed");
      expect(rows[0].created_by).toBe(ids.agentAAgentId);
      expect(rows[0].source).toBe("agent_self_sourced");
      expect(rows[0].imported_rows).toBe(1);
    });

    it("logs each import to the activity trail", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "Logged Co", state: "NJ" }]);

      const { rows } = await client.query(
        `select action, details from public.activity_log
         where action = 'lead.self_sourced_import'`
      );
      expect(rows).toHaveLength(1);
      expect((rows[0].details as { credited_to: string }).credited_to).toBe(
        ids.agentAAgentId
      );
    });

    it("refuses a file above the row ceiling", async () => {
      const rows = Array.from({ length: 5001 }, (_, i) => ({
        business_name: `Bulk ${i}`,
      }));
      await expect(importAs(ids.agentAUserId, rows)).rejects.toThrow(/5000 rows/);
    });
  });

  describe("who may import", () => {
    it("a deactivated agent cannot import", async () => {
      await expect(
        importAs(ids.inactiveUserId, [{ business_name: "Ghost Co" }])
      ).rejects.toThrow(/no active agent profile/);
    });

    it("an admin importing through this path is credited themselves", async () => {
      // Not a bug: an admin who uses the agent importer is sourcing leads.
      // Bulk imports for the team go through /api/imports, which assigns
      // nobody.
      const result = await importAs(ids.adminUserId, [
        { business_name: "Admin Sourced", state: "NJ" },
      ]);
      expect(result.credited_to).toBe(ids.adminAgentId);
    });
  });

  describe("the leads block is still in place", () => {
    it("an agent still cannot insert a lead directly", async () => {
      await asUser(client, ids.agentAUserId, async (q) => {
        const code = await q.errorCode(
          `insert into public.leads (business_name) values ('Direct Insert')`
        );
        expect(code).toBe("42501");
      });
    });

    it("an agent cannot insert a lead even when assigning it to themselves", async () => {
      await asUser(client, ids.agentAUserId, async (q) => {
        const code = await q.errorCode(
          `insert into public.leads (business_name, assigned_to) values ('Self Insert', $1)`,
          [ids.agentAAgentId]
        );
        expect(code).toBe("42501");
      });
    });

    it("there is no INSERT policy on leads for anyone but an admin", async () => {
      const { rows } = await client.query<{ policyname: string; with_check: string }>(
        `select policyname, with_check from pg_policies
         where schemaname = 'public' and tablename = 'leads' and cmd = 'INSERT'`
      );
      expect(rows).toEqual([]);
    });

    it("an agent cannot reassign an imported lead to a teammate", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "Mine Co", state: "NJ" }]);

      await asUser(client, ids.agentAUserId, async (q) => {
        // 42501, raised by the WITH CHECK on the agent update policy — the
        // same wall that stops them giving away a lead an admin assigned.
        const code = await q.errorCode(
          `update public.leads set assigned_to = $1 where business_name = 'Mine Co'`,
          [ids.agentBAgentId]
        );
        expect(code).toBe("42501");
      });
    });

    it("an imported lead is visible to its owner and to nobody else", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "Private Co", state: "NJ" }]);

      await asUser(client, ids.agentAUserId, async (q) => {
        const rows = await q.rows(
          `select id from public.leads where business_name = 'Private Co'`
        );
        expect(rows).toHaveLength(1);
      });
      await asUser(client, ids.agentBUserId, async (q) => {
        const rows = await q.rows(
          `select id from public.leads where business_name = 'Private Co'`
        );
        expect(rows).toHaveLength(0);
      });
    });

    it("the importing agent can read their own attribution", async () => {
      await importAs(ids.agentAUserId, [{ business_name: "Readable Co", state: "NJ" }]);

      await asUser(client, ids.agentAUserId, async (q) => {
        const rows = await q.rows(
          `select source from public.attributions`
        );
        expect(rows).toEqual([{ source: "self_sourced" }]);
      });
      await asUser(client, ids.agentBUserId, async (q) => {
        expect(await q.rows(`select source from public.attributions`)).toEqual([]);
      });
    });
  });

  describe("the admin import path still works", () => {
    it("an admin can still insert leads directly, as /api/imports does", async () => {
      await asUser(client, ids.adminUserId, async (q) => {
        const affected = await q.count(
          `insert into public.leads (business_name, state, source, lifecycle_status)
           values ('Admin Bulk Co', 'NJ', 'NJ Business Records', 'new')`
        );
        expect(affected).toBe(1);
      });
    });

    it("an admin-imported lead is unassigned and carries no attribution", async () => {
      // The admin importer sources for the team, so it credits nobody. If it
      // started writing attributions, every bulk-imported lead would look
      // self-sourced by whoever ran the upload.
      await client.query(
        `insert into public.leads (business_name, state, source) values ('Bulk Co', 'NJ', 'csv')`
      );
      const { rows } = await client.query(
        `select l.assigned_to, count(a.id)::int as attributions
         from public.leads l left join public.attributions a on a.lead_id = l.id
         where l.business_name = 'Bulk Co' group by l.assigned_to`
      );
      expect(rows[0].assigned_to).toBeNull();
      expect(rows[0].attributions).toBe(0);
    });

    it("an admin can still write an import job", async () => {
      await asUser(client, ids.adminUserId, async (q) => {
        const affected = await q.count(
          `insert into public.import_jobs (filename, total_rows, status)
           values ('admin.csv', 10, 'processing')`
        );
        expect(affected).toBe(1);
      });
    });

    it("existing import jobs default to the admin_upload source", async () => {
      await client.query(
        `insert into public.import_jobs (filename, total_rows) values ('legacy.csv', 3)`
      );
      const { rows } = await client.query(
        `select source, created_by from public.import_jobs where filename = 'legacy.csv'`
      );
      expect(rows[0].source).toBe("admin_upload");
      expect(rows[0].created_by).toBeNull();
    });
  });

  describe("the function itself", () => {
    it("is SECURITY DEFINER with a pinned search_path", async () => {
      const { rows } = await client.query<{
        prosecdef: boolean;
        proconfig: string[] | null;
      }>(
        `select p.prosecdef, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'import_agent_leads'`
      );
      expect(rows[0].prosecdef).toBe(true);
      expect(rows[0].proconfig?.some((c) => c.startsWith("search_path="))).toBe(true);
    });

    it("is not executable by an unauthenticated caller", async () => {
      const { rows } = await client.query<{ has: boolean }>(
        `select has_function_privilege('anon', 'public.import_agent_leads(jsonb, text, integer)', 'execute') as has`
      );
      expect(rows[0].has).toBe(false);
    });

    it("rejects a payload that is not an array", async () => {
      await client.query("begin");
      try {
        await client.query(
          `select set_config('request.jwt.claims',
             json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
          [ids.agentAUserId]
        );
        await client.query("set local role authenticated");
        await expect(
          client.query(`select public.import_agent_leads('{"business_name":"x"}'::jsonb)`)
        ).rejects.toThrow(/JSON array/);
      } finally {
        await client.query("rollback");
      }
    });
  });
});
