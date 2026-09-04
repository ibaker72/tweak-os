import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { asUser, connect, hasTestDatabase, resetSchema, seed, type SeedIds } from "./helpers";

/**
 * The lead ↔ proposal relationship, at the level that actually enforces it.
 *
 * `proposals.lead_id` has existed since migration 00008; the "Start from a
 * Lead" workflow relies on it rather than on matching business names later.
 * These check the properties that workflow depends on: the link is optional,
 * it is permanent, several proposals may share a lead, and attaching one
 * changes nothing about the lead itself.
 */
const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("proposals.lead_id", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect("proposal_lead_link");
    await resetSchema(client);
    ids = await seed(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  describe("the column itself", () => {
    it("is a nullable foreign key onto leads", async () => {
      const { rows } = await client.query<{ is_nullable: string; data_type: string }>(
        `select is_nullable, data_type
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'proposals'
            and column_name = 'lead_id'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].is_nullable).toBe("YES");
      expect(rows[0].data_type).toBe("uuid");

      const { rows: fks } = await client.query<{ foreign_table: string }>(
        `select ccu.table_name as foreign_table
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on kcu.constraint_name = tc.constraint_name
           join information_schema.constraint_column_usage ccu
             on ccu.constraint_name = tc.constraint_name
          where tc.table_name = 'proposals'
            and tc.constraint_type = 'FOREIGN KEY'
            and kcu.column_name = 'lead_id'`
      );
      expect(fks.map((f) => f.foreign_table)).toContain("leads");
    });

    it("is indexed, so the picker's per-lead counts are not a scan", async () => {
      const { rows } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where tablename = 'proposals' and indexdef like '%lead_id%'`
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("rejects a lead id that does not exist", async () => {
      const code = await asUser(client, ids.adminUserId, (q) =>
        q.errorCode(
          `insert into proposals (client_name, created_by, lead_id)
           values ('Ghost', $1, '00000000-0000-4000-8000-000000000000')`,
          [ids.adminAgentId]
        )
      );
      expect(code).toBe("23503");
    });
  });

  describe("proposals with and without a lead", () => {
    it("stores the link when a proposal starts from a lead", async () => {
      const rows = await asUser(client, ids.agentAUserId, async (q) => {
        await q.rows(
          `insert into proposals (client_name, created_by, lead_id)
           values ('From lead A', $1, $2)`,
          [ids.agentAAgentId, ids.leadOfA]
        );
        return q.rows<{ lead_id: string }>(
          "select lead_id from proposals where client_name = 'From lead A'"
        );
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].lead_id).toBe(ids.leadOfA);
    });

    it("still accepts a proposal built by hand, with no lead", async () => {
      const rows = await asUser(client, ids.agentAUserId, async (q) => {
        await q.rows(
          "insert into proposals (client_name, created_by) values ('Manual', $1)",
          [ids.agentAAgentId]
        );
        return q.rows<{ lead_id: string | null }>(
          "select lead_id from proposals where client_name = 'Manual'"
        );
      });
      expect(rows[0].lead_id).toBeNull();
    });

    it("keeps a legacy NULL-lead proposal readable and editable by its creator", async () => {
      const updated = await asUser(client, ids.agentAUserId, async (q) => {
        await q.rows(
          "insert into proposals (client_name, created_by) values ('Legacy', $1)",
          [ids.agentAAgentId]
        );
        return q.count(
          "update proposals set client_name = 'Legacy edited' where client_name = 'Legacy'"
        );
      });
      expect(updated).toBe(1);
    });

    it("lets several proposals reference the same lead", async () => {
      const rows = await asUser(client, ids.agentAUserId, async (q) => {
        await q.rows(
          `insert into proposals (client_name, created_by, lead_id) values
             ('Round one', $1, $2), ('Round two', $1, $2)`,
          [ids.agentAAgentId, ids.leadOfA]
        );
        return q.rows<{ client_name: string }>(
          "select client_name from proposals where lead_id = $1 order by client_name",
          [ids.leadOfA]
        );
      });
      expect(rows.map((r) => r.client_name)).toContain("Round one");
      expect(rows.map((r) => r.client_name)).toContain("Round two");
    });

    it("keeps the proposal when its lead is deleted, dropping only the link", async () => {
      // Seeded outside a transaction so the delete below has something real
      // to cascade onto, then cleaned up in the same statement batch.
      const { rows: created } = await client.query<{ id: string }>(
        `insert into leads (business_name) values ('Temporary Lead') returning id`
      );
      const leadId = created[0].id;
      await client.query(
        `insert into proposals (client_name, created_by, lead_id) values ('Orphan-to-be', $1, $2)`,
        [ids.agentAAgentId, leadId]
      );

      await client.query("delete from leads where id = $1", [leadId]);

      const { rows } = await client.query<{ lead_id: string | null }>(
        "select lead_id from proposals where client_name = 'Orphan-to-be'"
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].lead_id).toBeNull();

      await client.query("delete from proposals where client_name = 'Orphan-to-be'");
    });
  });

  describe("attribution and ownership are untouched", () => {
    it("creating a proposal changes nothing on the lead", async () => {
      const before = await snapshotLead(client, ids.leadOfA);

      await asUser(client, ids.agentAUserId, (q) =>
        q.rows(
          `insert into proposals (client_name, created_by, lead_id)
           values ('Attribution check', $1, $2)`,
          [ids.agentAAgentId, ids.leadOfA]
        )
      );

      expect(await snapshotLead(client, ids.leadOfA)).toEqual(before);
    });

    it("attributes the proposal to its creator, not to the lead's owner", async () => {
      // Admin builds a proposal against agent A's lead: the lead stays agent
      // A's, and the proposal belongs to the admin who wrote it.
      const rows = await asUser(client, ids.adminUserId, async (q) => {
        await q.rows(
          `insert into proposals (client_name, created_by, lead_id)
           values ('Admin wrote this', $1, $2)`,
          [ids.adminAgentId, ids.leadOfA]
        );
        return q.rows<{ created_by: string; assigned_to: string }>(
          `select p.created_by, l.assigned_to
             from proposals p join leads l on l.id = p.lead_id
            where p.client_name = 'Admin wrote this'`
        );
      });

      expect(rows[0].created_by).toBe(ids.adminAgentId);
      expect(rows[0].assigned_to).toBe(ids.agentAAgentId);
    });
  });

  describe("authorship survives a lead reassignment", () => {
    // POST /api/proposals used to include created_by in the update payload as
    // well as the insert. proposals_agent_update also admits whoever owns the
    // linked lead, so once a lead moved to another agent, that agent's first
    // Save rewrote created_by to themselves — and the original author, who was
    // by then neither the creator nor the lead owner, fell out of the select
    // policy and could never open their own proposal again. Silently, on a
    // button that says "Save".
    //
    // The route now drops created_by from the update, so this asserts the
    // column the route no longer touches stays put.
    it("an edit by the new lead owner does not reassign created_by", async () => {
      const { rows } = await client.query(
        `insert into proposals (client_name, created_by, lead_id)
         values ('Authored by A', $1, $2) returning id`,
        [ids.agentAAgentId, ids.leadOfA]
      );
      const proposalId = rows[0].id as string;

      await client.query(`update leads set assigned_to = $1 where id = $2`, [
        ids.agentBAgentId,
        ids.leadOfA,
      ]);

      try {
        // Exactly the columns the route's update branch writes now.
        await asUser(client, ids.agentBUserId, (q) =>
          q.rows(
            `update proposals
               set client_name = 'Edited by B', last_edited_at = now()
             where id = $1`,
            [proposalId]
          )
        );

        const after = await client.query(
          `select created_by from proposals where id = $1`,
          [proposalId]
        );
        expect(after.rows[0].created_by).toBe(ids.agentAAgentId);
      } finally {
        await client.query(`update leads set assigned_to = $1 where id = $2`, [
          ids.agentAAgentId,
          ids.leadOfA,
        ]);
      }
    });

    it("the author can still read their proposal after the lead moves", async () => {
      const { rows } = await client.query(
        `insert into proposals (client_name, created_by, lead_id)
         values ('Still A''s', $1, $2) returning id`,
        [ids.agentAAgentId, ids.leadOfA]
      );
      const proposalId = rows[0].id as string;

      await client.query(`update leads set assigned_to = $1 where id = $2`, [
        ids.agentBAgentId,
        ids.leadOfA,
      ]);

      try {
        const visible = await asUser(client, ids.agentAUserId, (q) =>
          q.rows(`select id from proposals where id = $1`, [proposalId])
        );
        expect(visible).toHaveLength(1);
      } finally {
        await client.query(`update leads set assigned_to = $1 where id = $2`, [
          ids.agentAAgentId,
          ids.leadOfA,
        ]);
      }
    });
  });

  describe("RLS still decides who can pick which lead", () => {
    it("an agent cannot see a teammate's lead, so cannot attach one", async () => {
      // This is what the API's visibility check reads: no row, no attach.
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from leads where id = $1", [ids.leadOfB])
      );
      expect(rows).toHaveLength(0);
    });

    it("an agent cannot read a proposal attached to a teammate's lead", async () => {
      await asUser(client, ids.agentBUserId, (q) =>
        q.rows(
          `insert into proposals (client_name, created_by, lead_id)
           values ('B private', $1, $2)`,
          [ids.agentBAgentId, ids.leadOfB]
        )
      );

      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from proposals where client_name = 'B private'")
      );
      expect(rows).toHaveLength(0);
    });

    it("an admin keeps their existing access to every proposal", async () => {
      await client.query(
        `insert into proposals (client_name, created_by, lead_id)
         values ('Visible to admin', $1, $2)`,
        [ids.agentBAgentId, ids.leadOfB]
      );

      const rows = await asUser(client, ids.adminUserId, (q) =>
        q.rows("select id from proposals where client_name = 'Visible to admin'")
      );
      expect(rows).toHaveLength(1);

      await client.query("delete from proposals where client_name = 'Visible to admin'");
    });
  });
});

async function snapshotLead(client: Client, leadId: string) {
  const { rows } = await client.query(
    `select assigned_to, assigned_at, lifecycle_status, previous_status, score,
            next_action, next_action_date, contacted_at, updated_at
       from leads where id = $1`,
    [leadId]
  );
  return rows[0];
}
