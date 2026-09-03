import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Client } from "pg";
import {
  connect,
  connectAlso,
  hasTestDatabase,
  resetSchema,
  seed,
  type SeedIds,
} from "./helpers";
import {
  dedupeKeysFor,
  domainKey,
  duplicateReason,
  emailKey,
  nameKey,
  normalizeCity,
  normalizeState,
  phoneKey,
} from "../../src/lib/leads/normalize";

/**
 * The workflow this whole thing exists for.
 *
 * A partner keeps prospects in a Google Sheet. They export it and upload the
 * CSV. Later they add more rows to the SAME sheet and upload the whole file
 * again — every row from the first upload included. Mary's original seven
 * must not become fourteen.
 *
 * These run against a real Postgres with the real migrations applied, because
 * the policy lives in SQL and a test of a TypeScript re-implementation of it
 * would only prove the test agrees with itself.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("lead deduplication", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect("leaddedupe");
    await resetSchema(client);
    ids = await seed(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await client.query(`
      delete from public.attributions;
      delete from public.activity_log;
      delete from public.import_jobs;
      delete from public.leads
       where business_name not in ('Lead of A', 'Lead of B', 'Unassigned Lead');
    `);
  });

  type Row = Record<string, unknown>;
  interface ImportResult {
    total_rows: number;
    imported_rows: number;
    skipped_duplicates: number;
    invalid_rows: number;
    failed_rows: number;
    credited_to?: string;
    results: {
      row: number;
      business_name: string | null;
      status: string;
      reason?: string;
      owned_by_other_agent?: boolean;
    }[];
  }

  async function importAs(
    userId: string,
    rows: Row[],
    filename = "marys-sheet.csv",
    fn: "import_agent_leads" | "import_bulk_leads" = "import_agent_leads"
  ): Promise<ImportResult> {
    await client.query("begin");
    try {
      await client.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [userId]
      );
      await client.query("set local role authenticated");
      const { rows: out } = await client.query<{ result: ImportResult }>(
        `select public.${fn}($1::jsonb, $2::text) as result`,
        [JSON.stringify(rows), filename]
      );
      await client.query("commit");
      return out[0].result;
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  /** Run a read as the seeded admin, then roll back. */
  async function asAdmin(fn: () => Promise<void>): Promise<void> {
    await client.query("begin");
    try {
      await client.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [ids.adminUserId]
      );
      await client.query("set local role authenticated");
      await fn();
    } finally {
      await client.query("rollback");
    }
  }

  async function leadCount(): Promise<number> {
    const { rows } = await client.query<{ n: number }>(
      `select count(*)::int as n from public.leads`
    );
    return rows[0].n;
  }

  // ==========================================================================
  // Mary's sheet
  // ==========================================================================

  /** The seven she started with. */
  const FIRST_SEVEN: Row[] = [
    {
      business_name: "ABC Plumbing LLC",
      city: "Paterson",
      state: "NJ",
      phone: "(862) 555-1212",
      website: "https://www.abcplumbing.com/",
    },
    {
      business_name: "XYZ HVAC",
      city: "Newark",
      state: "NJ",
      phone: "973-555-0100",
      email: "Info@XyzHvac.com",
    },
    {
      business_name: "Smith Electric",
      city: "Newark",
      state: "NJ",
      website: "http://smithelectric.com",
    },
    { business_name: "Delta Roofing", city: "Clifton", state: "NJ", phone: "2015550111" },
    {
      business_name: "Echo Landscaping",
      city: "Passaic",
      state: "NJ",
      email: "hello@echoland.com",
    },
    { business_name: "Foxtrot Auto", city: "Paterson", state: "NJ", phone: "+19735550122" },
    {
      business_name: "Golf Bakery",
      city: "Newark",
      state: "NJ",
      website: "golfbakery.com/contact",
    },
  ];

  /**
   * The same seven businesses as they come back out of the sheet later.
   *
   * Every difference here is one a real Google Sheet round trip produces:
   * a comma typed into a company name, a phone re-entered without formatting,
   * a URL pasted with the protocol this time, a state column left blank on one
   * row. None of them is a different business.
   */
  const FIRST_SEVEN_DRIFTED: Row[] = [
    {
      business_name: "ABC Plumbing, LLC",
      city: "Paterson",
      state: "NJ",
      phone: "8625551212",
      website: "abcplumbing.com",
    },
    {
      business_name: "XYZ HVAC",
      city: "Newark",
      state: "New Jersey",
      phone: "(973) 555-0100",
      email: "info@xyzhvac.com",
    },
    {
      business_name: "Smith Electric",
      city: "Newark",
      state: "NJ",
      website: "https://www.smithelectric.com",
    },
    { business_name: "Delta Roofing", city: "Clifton", phone: "(201) 555-0111" },
    {
      business_name: "Echo Landscaping",
      city: "Passaic",
      state: "NJ",
      email: "HELLO@echoland.com",
    },
    { business_name: "Foxtrot Auto", city: "Paterson", state: "NJ", phone: "973-555-0122" },
    {
      business_name: "Golf Bakery",
      city: "Newark",
      state: "NJ",
      website: "http://golfbakery.com/",
    },
  ];

  /** The seven she added later. */
  const NEXT_SEVEN: Row[] = [
    { business_name: "Hotel Supply Co", city: "Newark", state: "NJ", phone: "9735550201" },
    { business_name: "India Tile", city: "Newark", state: "NJ", phone: "9735550202" },
    { business_name: "Juliet Cafe", city: "Newark", state: "NJ", phone: "9735550203" },
    { business_name: "Kilo Fitness", city: "Newark", state: "NJ", phone: "9735550204" },
    { business_name: "Lima Dental", city: "Newark", state: "NJ", phone: "9735550205" },
    { business_name: "Mike Movers", city: "Newark", state: "NJ", phone: "9735550206" },
    { business_name: "November Nails", city: "Newark", state: "NJ", phone: "9735550207" },
  ];

  const FULL_FOURTEEN = [...FIRST_SEVEN_DRIFTED, ...NEXT_SEVEN];

  describe("re-uploading the same growing sheet", () => {
    it("imports 7, then adds only the 7 new ones, then adds nothing", async () => {
      const before = await leadCount();

      const first = await importAs(ids.agentAUserId, FIRST_SEVEN);
      expect(first.total_rows).toBe(7);
      expect(first.imported_rows).toBe(7);
      expect(first.skipped_duplicates).toBe(0);
      expect(await leadCount()).toBe(before + 7);

      // The whole sheet again, now fourteen rows: the original seven plus
      // seven new prospects.
      const second = await importAs(ids.agentAUserId, FULL_FOURTEEN);
      expect(second.total_rows).toBe(14);
      expect(second.imported_rows).toBe(7);
      expect(second.skipped_duplicates).toBe(7);
      expect(second.invalid_rows).toBe(0);
      expect(second.failed_rows).toBe(0);
      // The count is the assertion that matters: 7 more leads, not 14.
      expect(await leadCount()).toBe(before + 14);

      // The identical file a third time changes nothing at all.
      const third = await importAs(ids.agentAUserId, FULL_FOURTEEN);
      expect(third.total_rows).toBe(14);
      expect(third.imported_rows).toBe(0);
      expect(third.skipped_duplicates).toBe(14);
      expect(await leadCount()).toBe(before + 14);
    });

    it("keeps exactly one lead per business after three uploads", async () => {
      await importAs(ids.agentAUserId, FIRST_SEVEN);
      await importAs(ids.agentAUserId, FULL_FOURTEEN);
      await importAs(ids.agentAUserId, FULL_FOURTEEN);

      const { rows } = await client.query<{ dedupe_name: string; n: number }>(
        `select dedupe_name, count(*)::int as n
         from public.leads
         where source = 'self_sourced'
         group by dedupe_name
         having count(*) > 1`
      );
      expect(rows).toEqual([]);

      // And the name each one kept is the one from the FIRST upload — a
      // re-upload does not rewrite what is already there.
      const { rows: abc } = await client.query<{ business_name: string }>(
        `select business_name from public.leads where dedupe_name = 'abc plumbing'`
      );
      expect(abc).toEqual([{ business_name: "ABC Plumbing LLC" }]);
    });

    it("says which identifier matched, per row", async () => {
      await importAs(ids.agentAUserId, FIRST_SEVEN);
      const second = await importAs(ids.agentAUserId, FULL_FOURTEEN);

      const byName = new Map(
        second.results.map((r) => [r.business_name, r] as const)
      );
      expect(byName.get("ABC Plumbing, LLC")).toMatchObject({
        status: "duplicate_skipped",
        reason: "phone",
      });
      expect(byName.get("Smith Electric")).toMatchObject({
        status: "duplicate_skipped",
        reason: "domain",
      });
      expect(byName.get("Echo Landscaping")).toMatchObject({
        status: "duplicate_skipped",
        reason: "email",
      });
      expect(byName.get("Hotel Supply Co")).toMatchObject({ status: "imported" });
    });

    it("records the counts on the import job", async () => {
      await importAs(ids.agentAUserId, FIRST_SEVEN, "sheet-v1.csv");
      await importAs(ids.agentAUserId, FULL_FOURTEEN, "sheet-v2.csv");

      const { rows } = await client.query(
        `select filename, total_rows, imported_rows, skipped_rows, invalid_rows,
                failed_rows, status, created_by, source
         from public.import_jobs order by filename`
      );
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        filename: "sheet-v2.csv",
        total_rows: 14,
        imported_rows: 7,
        skipped_rows: 7,
        invalid_rows: 0,
        failed_rows: 0,
        status: "completed",
        created_by: ids.agentAAgentId,
        source: "agent_self_sourced",
      });
    });
  });

  // ==========================================================================
  // Duplicates inside one file
  // ==========================================================================

  describe("duplicates within a single upload", () => {
    it("creates one lead when two rows share a phone number", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "ABC Plumbing", city: "Paterson", state: "NJ", phone: "(862) 555-1212" },
        { business_name: "Filler Co", city: "Newark", state: "NJ", phone: "9735559999" },
        { business_name: "ABC Plumbing", city: "Paterson", state: "NJ", phone: "+18625551212" },
      ]);

      expect(result.imported_rows).toBe(2);
      expect(result.skipped_duplicates).toBe(1);

      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from public.leads where dedupe_phone = '+18625551212'`
      );
      expect(rows[0].n).toBe(1);
    });

    it("creates one lead when two rows share a website written differently", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Zeta Co", city: "Newark", state: "NJ", website: "example.com/contact" },
        { business_name: "Zeta Company", city: "Newark", state: "NJ", website: "https://www.example.com/" },
      ]);
      expect(result.imported_rows).toBe(1);
      expect(result.skipped_duplicates).toBe(1);
    });

    it("creates one lead when two rows share an email written differently", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Yankee Co", city: "Newark", state: "NJ", email: "TEST@Example.com" },
        { business_name: "Yankee Corp", city: "Newark", state: "NJ", email: "test@example.com" },
      ]);
      expect(result.imported_rows).toBe(1);
      expect(result.skipped_duplicates).toBe(1);
    });

    it("creates one lead when two rows are the same name and place", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Whiskey Bakery LLC", city: "Paterson", state: "NJ" },
        { business_name: "Whiskey Bakery, LLC", city: "Paterson", state: "New Jersey" },
      ]);
      expect(result.imported_rows).toBe(1);
      expect(result.skipped_duplicates).toBe(1);
    });
  });

  // ==========================================================================
  // Businesses that must NOT be merged
  // ==========================================================================

  describe("businesses that stay separate", () => {
    it("keeps the same name in two cities apart", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "ABC Plumbing", city: "Paterson", state: "NJ" },
        { business_name: "ABC Plumbing", city: "Newark", state: "NJ" },
      ]);
      expect(result.imported_rows).toBe(2);
      expect(result.skipped_duplicates).toBe(0);
    });

    it("keeps the same name in two states apart", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Multi Co", state: "NJ" },
        { business_name: "Multi Co", state: "PA" },
      ]);
      expect(result.imported_rows).toBe(2);
    });

    it("keeps two franchise locations sharing a corporate domain apart", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Sandwich Co", city: "Paterson", state: "NJ", website: "sandwichco.com" },
        { business_name: "Sandwich Co", city: "Newark", state: "NJ", website: "https://www.sandwichco.com/" },
      ]);
      expect(result.imported_rows).toBe(2);
      expect(result.skipped_duplicates).toBe(0);
    });

    it("keeps two franchise locations sharing an info@ address apart", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Sandwich Co", city: "Paterson", state: "NJ", email: "info@sandwichco.com" },
        { business_name: "Sandwich Co", city: "Newark", state: "NJ", email: "INFO@sandwichco.com" },
      ]);
      expect(result.imported_rows).toBe(2);
    });

    it("does not merge generic trade names that happen to collide", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Plumbing Services", city: "Newark", state: "NJ" },
        { business_name: "Plumbing Services LLC", city: "Newark", state: "NJ" },
      ]);
      expect(result.imported_rows).toBe(2);
    });

    it("does not merge two businesses that both list a Facebook page", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Alpha Cakes", city: "Newark", state: "NJ", website: "https://facebook.com/alpha" },
        { business_name: "Bravo Tools", city: "Newark", state: "NJ", website: "https://www.facebook.com/bravo" },
      ]);
      expect(result.imported_rows).toBe(2);
    });

    it("does not merge two businesses that both list a Gmail address as a website", async () => {
      const result = await importAs(ids.agentAUserId, [
        { business_name: "Charlie Tiles", city: "Newark", state: "NJ", website: "gmail.com" },
        { business_name: "Golf Signage", city: "Newark", state: "NJ", website: "gmail.com" },
      ]);
      expect(result.imported_rows).toBe(2);
    });
  });

  // ==========================================================================
  // Attribution and commission safety
  // ==========================================================================

  describe("attribution safety on a re-upload", () => {
    it("writes no second attribution for a skipped row", async () => {
      await importAs(ids.agentAUserId, FIRST_SEVEN);
      await importAs(ids.agentAUserId, FULL_FOURTEEN);
      await importAs(ids.agentAUserId, FULL_FOURTEEN);

      const { rows } = await client.query<{ lead_id: string; n: number }>(
        `select lead_id, count(*)::int as n from public.attributions
         group by lead_id having count(*) > 1`
      );
      expect(rows).toEqual([]);

      const { rows: totals } = await client.query<{ leads: number; attributions: number }>(
        `select (select count(*)::int from public.leads where source = 'self_sourced') as leads,
                (select count(*)::int from public.attributions) as attributions`
      );
      expect(totals[0].attributions).toBe(totals[0].leads);
    });

    it("does not give a second partner credit for a lead the first one sourced", async () => {
      await importAs(ids.agentAUserId, FIRST_SEVEN);

      // Agent B uploads a sheet containing agent A's businesses.
      const result = await importAs(ids.agentBUserId, FIRST_SEVEN_DRIFTED);
      expect(result.imported_rows).toBe(0);
      expect(result.skipped_duplicates).toBe(7);

      const { rows } = await client.query<{ agent_id: string; n: number }>(
        `select agent_id, count(*)::int as n from public.attributions group by agent_id`
      );
      expect(rows).toEqual([{ agent_id: ids.agentAAgentId, n: 7 }]);
    });

    it("leaves the original owner in place — no silent reassignment", async () => {
      await importAs(ids.agentAUserId, FIRST_SEVEN);
      await importAs(ids.agentBUserId, FIRST_SEVEN_DRIFTED);

      const { rows } = await client.query<{ assigned_to: string; n: number }>(
        `select assigned_to, count(*)::int as n from public.leads
         where source = 'self_sourced' group by assigned_to`
      );
      expect(rows).toEqual([{ assigned_to: ids.agentAAgentId, n: 7 }]);
    });

    it("tells the second partner the lead is already owned by someone else", async () => {
      await importAs(ids.agentAUserId, [FIRST_SEVEN[0]]);
      const result = await importAs(ids.agentBUserId, [FIRST_SEVEN_DRIFTED[0]]);

      expect(result.results[0]).toMatchObject({
        status: "duplicate_skipped",
        reason: "phone",
        owned_by_other_agent: true,
      });
    });

    it("does not flag the partner's own lead as owned by someone else", async () => {
      await importAs(ids.agentAUserId, [FIRST_SEVEN[0]]);
      const result = await importAs(ids.agentAUserId, [FIRST_SEVEN_DRIFTED[0]]);
      expect(result.results[0]).toMatchObject({
        status: "duplicate_skipped",
        owned_by_other_agent: false,
      });
    });

    it("does not reset pipeline state, enrichment or notes on a skipped row", async () => {
      await importAs(ids.agentAUserId, [FIRST_SEVEN[0]]);

      // The partner has since worked the lead.
      await client.query(`
        update public.leads
        set lifecycle_status = 'meeting_booked',
            enrichment_status = 'completed',
            score = 82,
            manual_notes = 'Spoke to the owner, sending a proposal Monday',
            email_1 = 'owner@abcplumbing.com'
        where dedupe_phone = '+18625551212'
      `);
      const { rows: before } = await client.query(
        `select lifecycle_status, enrichment_status, score, manual_notes, email_1,
                business_name, updated_at
         from public.leads where dedupe_phone = '+18625551212'`
      );

      await importAs(ids.agentAUserId, [FIRST_SEVEN_DRIFTED[0]]);

      const { rows: after } = await client.query(
        `select lifecycle_status, enrichment_status, score, manual_notes, email_1,
                business_name, updated_at
         from public.leads where dedupe_phone = '+18625551212'`
      );
      // Byte for byte, including updated_at: a skipped row is not an UPDATE.
      expect(after).toEqual(before);
    });

    it("logs nothing to the activity trail for a skipped row", async () => {
      await importAs(ids.agentAUserId, [FIRST_SEVEN[0]]);
      await importAs(ids.agentAUserId, [FIRST_SEVEN_DRIFTED[0]]);

      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n from public.activity_log
         where action = 'lead.self_sourced_import'`
      );
      expect(rows[0].n).toBe(1);
    });
  });

  // ==========================================================================
  // Concurrency
  // ==========================================================================

  describe("two partners uploading at the same moment", () => {
    it("still creates only one lead", async () => {
      const other = await connectAlso("leaddedupe");
      try {
        const row = {
          business_name: "Race Condition Co",
          city: "Newark",
          state: "NJ",
          phone: "9735558888",
        };

        const run = async (c: Client, userId: string) => {
          await c.query("begin");
          try {
            await c.query(
              `select set_config('request.jwt.claims',
                 json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
              [userId]
            );
            await c.query("set local role authenticated");
            const { rows } = await c.query<{ result: ImportResult }>(
              `select public.import_agent_leads($1::jsonb, 'race.csv') as result`,
              [JSON.stringify([row])]
            );
            await c.query("commit");
            return rows[0].result;
          } catch (err) {
            await c.query("rollback");
            throw err;
          }
        };

        // Both start before either commits. Without the import lock both see
        // an empty table and both insert.
        const [a, b] = await Promise.all([
          run(client, ids.agentAUserId),
          run(other, ids.agentBUserId),
        ]);

        const imported = a.imported_rows + b.imported_rows;
        const skipped = a.skipped_duplicates + b.skipped_duplicates;
        expect(imported).toBe(1);
        expect(skipped).toBe(1);

        const { rows } = await client.query<{ n: number }>(
          `select count(*)::int as n from public.leads
           where business_name = 'Race Condition Co'`
        );
        expect(rows[0].n).toBe(1);
      } finally {
        await other.end();
      }
    }, 60_000);
  });

  // ==========================================================================
  // The admin bulk importer
  // ==========================================================================

  describe("the admin bulk importer", () => {
    it("dedupes on the same policy as the agent importer", async () => {
      const first = await importAs(
        ids.adminUserId, FIRST_SEVEN, "team-v1.csv", "import_bulk_leads"
      );
      expect(first.imported_rows).toBe(7);

      const second = await importAs(
        ids.adminUserId, FULL_FOURTEEN, "team-v2.csv", "import_bulk_leads"
      );
      expect(second.imported_rows).toBe(7);
      expect(second.skipped_duplicates).toBe(7);
    });

    it("assigns nobody and writes no attribution", async () => {
      await importAs(ids.adminUserId, FIRST_SEVEN, "team.csv", "import_bulk_leads");

      const { rows } = await client.query<{ assigned: number; attributions: number }>(
        `select (select count(*)::int from public.leads
                  where source is distinct from 'self_sourced' and assigned_to is not null
                    and business_name not in ('Lead of A','Lead of B')) as assigned,
                (select count(*)::int from public.attributions) as attributions`
      );
      expect(rows[0].assigned).toBe(0);
      expect(rows[0].attributions).toBe(0);
    });

    it("does not pull a lead back off the agent working it", async () => {
      await importAs(ids.agentAUserId, FIRST_SEVEN);
      const result = await importAs(
        ids.adminUserId, FIRST_SEVEN_DRIFTED, "team.csv", "import_bulk_leads"
      );
      expect(result.skipped_duplicates).toBe(7);

      const { rows } = await client.query<{ assigned_to: string; n: number }>(
        `select assigned_to, count(*)::int as n from public.leads
         where source = 'self_sourced' group by assigned_to`
      );
      expect(rows).toEqual([{ assigned_to: ids.agentAAgentId, n: 7 }]);
    });

    it("refuses a non-admin caller", async () => {
      await expect(
        importAs(ids.agentAUserId, FIRST_SEVEN, "team.csv", "import_bulk_leads")
      ).rejects.toThrow(/only an admin/);
    });

    it("does not treat a company name containing % as a wildcard", async () => {
      // The old ILIKE check matched "100% Roofing" against anything starting
      // "100" and ending " Roofing", and skipped a real lead as a duplicate.
      await importAs(
        ids.adminUserId,
        [{ business_name: "100 Percent Roofing", city: "Newark", state: "NJ" }],
        "a.csv",
        "import_bulk_leads"
      );
      const result = await importAs(
        ids.adminUserId,
        [{ business_name: "100% Roofing", city: "Newark", state: "NJ" }],
        "b.csv",
        "import_bulk_leads"
      );
      expect(result.imported_rows).toBe(1);
      expect(result.skipped_duplicates).toBe(0);
    });
  });

  // ==========================================================================
  // The audit
  // ==========================================================================

  describe("auditing duplicates that already exist", () => {
    it("reports pre-existing duplicates without touching them", async () => {
      // Written straight to the table, the way the old importer would have.
      // Distinct created_at values so "which one came first" is well defined —
      // the report names the newer lead as the duplicate of the older one.
      await client.query(`
        insert into public.leads (business_name, city, state, phone, source, assigned_to, created_at)
        values ('Legacy Plumbing', 'Newark', 'NJ', '(973) 555-7000', 'csv', $1, now() - interval '2 days'),
               ('Legacy Plumbing LLC', 'Newark', 'NJ', '9735557000', 'csv', $2, now() - interval '1 day')
      `, [ids.agentAAgentId, ids.agentBAgentId]);

      const before = await leadCount();

      await asAdmin(async () => {
        const { rows } = await client.query<{ result: Record<string, unknown> }>(
          `select public.count_duplicate_leads() as result`
        );
        expect(rows[0].result).toMatchObject({
          duplicate_leads: 1,
          cross_owner_duplicates: 1,
        });

        const { rows: detail } = await client.query(
          `select business_name, matched_by, duplicate_of_name, same_owner
           from public.report_duplicate_leads()`
        );
        expect(detail).toEqual([
          {
            business_name: "Legacy Plumbing LLC",
            matched_by: "phone",
            duplicate_of_name: "Legacy Plumbing",
            same_owner: false,
          },
        ]);
      });

      // Reporting is all it does.
      expect(await leadCount()).toBe(before);
    });

    it("is admin-only", async () => {
      await client.query("begin");
      try {
        await client.query(
          `select set_config('request.jwt.claims',
             json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
          [ids.agentAUserId]
        );
        await client.query("set local role authenticated");
        await expect(
          client.query(`select public.report_duplicate_leads()`)
        ).rejects.toThrow(/only an admin/);
      } finally {
        await client.query("rollback");
      }
    });
  });

  // ==========================================================================
  // The two copies of the policy agree
  // ==========================================================================

  describe("the SQL and TypeScript normalizers agree", () => {
    const PHONES = [
      "(862) 555-1212", "8625551212", "+18625551212", "1-862-555-1212",
      "862.555.1212", "555", "", "not a phone", "+442079460958",
    ];
    const EMAILS = [
      "TEST@Example.com", " test@example.com ", "Info@XyzHvac.com",
      "no-at-sign", "missing@tld", "", "a@b.co",
    ];
    const DOMAINS = [
      "https://www.example.com/", "http://example.com", "example.com/contact",
      "https://user:pw@www.example.com:8443/a?b=1#c", "shop.example.com",
      "https://www.facebook.com/joes", "gmail.com", "not a url", "example.", "",
    ];
    const NAMES = [
      "ABC Plumbing LLC", "ABC Plumbing, LLC", "A.B.C. Plumbing",
      "Smith & Sons Co LLC", "Plumbing Services", "The Company", "LLC",
      "100% Roofing", "  spaced   out  ", "",
    ];
    const CITIES = ["Paterson", " newark ", "St. Louis", "", "Jersey City"];
    const STATES = ["NJ", "nj", "New Jersey", "N.J.", "", "Ontario"];

    async function sqlValues(fn: string, inputs: string[]): Promise<(string | null)[]> {
      const { rows } = await client.query<{ i: number; v: string | null }>(
        `select ord as i, ${fn}(value) as v
         from unnest($1::text[]) with ordinality as t(value, ord)
         order by ord`,
        [inputs]
      );
      return rows.map((r) => r.v);
    }

    it("agrees on phone numbers", async () => {
      expect(await sqlValues("private.normalize_phone", PHONES)).toEqual(
        PHONES.map(phoneKey)
      );
    });

    it("agrees on emails", async () => {
      expect(await sqlValues("private.normalize_email_key", EMAILS)).toEqual(
        EMAILS.map(emailKey)
      );
    });

    it("agrees on domains, blocklist included", async () => {
      expect(await sqlValues("private.normalize_domain_key", DOMAINS)).toEqual(
        DOMAINS.map(domainKey)
      );
    });

    it("agrees on business names, generic-name guard included", async () => {
      expect(await sqlValues("private.normalize_name_key", NAMES)).toEqual(
        NAMES.map(nameKey)
      );
    });

    it("agrees on cities and states", async () => {
      expect(await sqlValues("private.normalize_city_key", CITIES)).toEqual(
        CITIES.map(normalizeCity)
      );
      expect(await sqlValues("private.normalize_state_key", STATES)).toEqual(
        STATES.map(normalizeState)
      );
    });

    it("agrees on which tier matches, across the whole policy", async () => {
      const pairs: [Record<string, string | undefined>, Record<string, string | undefined>][] = [
        [{ business_name: "A", phone: "(862) 555-1212" }, { business_name: "B", phone: "8625551212" }],
        [{ business_name: "A", email: "TEST@Example.com" }, { business_name: "B", email: "test@example.com" }],
        [{ business_name: "A Co", website: "example.com/x" }, { business_name: "B Co", website: "https://www.example.com" }],
        [
          { business_name: "ABC Plumbing LLC", city: "Paterson", state: "NJ" },
          { business_name: "ABC Plumbing, LLC", city: "Paterson", state: "New Jersey" },
        ],
        [
          { business_name: "ABC Plumbing", city: "Paterson", state: "NJ" },
          { business_name: "ABC Plumbing", city: "Newark", state: "NJ" },
        ],
        [
          { business_name: "Sandwich Co", city: "Paterson", state: "NJ", website: "sandwichco.com" },
          { business_name: "Sandwich Co", city: "Newark", state: "NJ", website: "www.sandwichco.com" },
        ],
        [{ business_name: "Plumbing" }, { business_name: "Plumbing" }],
        [{ business_name: "X", external_id: "NJ-1" }, { business_name: "Y", external_id: "nj-1" }],
      ];

      for (const [existing, candidate] of pairs) {
        await client.query("begin");
        try {
          await client.query(
            `insert into public.leads (business_name, city, state, website, email, phone, external_id)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              existing.business_name, existing.city ?? null, existing.state ?? null,
              existing.website ?? null, existing.email ?? null, existing.phone ?? null,
              existing.external_id ?? null,
            ]
          );
          const { rows } = await client.query<{ matched_by: string | null }>(
            `select matched_by from private.find_duplicate_lead($1, $2, $3, $4, $5, $6, $7)`,
            [
              candidate.business_name, candidate.city ?? null, candidate.state ?? null,
              candidate.website ?? null, candidate.email ?? null, candidate.phone ?? null,
              candidate.external_id ?? null,
            ]
          );
          const sql = rows[0]?.matched_by ?? null;
          const ts = duplicateReason(
            dedupeKeysFor(candidate),
            dedupeKeysFor(existing)
          );
          expect({ pair: candidate.business_name, sql }).toEqual({
            pair: candidate.business_name,
            sql: ts,
          });
        } finally {
          await client.query("rollback");
        }
      }
    });
  });
});
