import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import {
  asAnon,
  asUser,
  connect,
  hasTestDatabase,
  resetSchema,
  seed,
  type SeedIds,
} from "./helpers";

/**
 * These are the tests that matter most in Phase 1. Everything else in the app
 * trusts that Postgres will not hand agent A agent B's rows; this suite is the
 * only thing that actually checks it.
 *
 * They run against a real Postgres with the real migrations applied, as the
 * `authenticated` role with a real request.jwt.claims — the same path a
 * PostgREST request takes. Set TEST_DATABASE_URL to run them.
 */
const describeRls = hasTestDatabase ? describe : describe.skip;

describeRls("RLS role scoping", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect("rls");
    await resetSchema(client);
    ids = await seed(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  // -------------------------------------------------------------------------
  // The core boundary: agent A must not reach agent B's leads.
  // -------------------------------------------------------------------------

  describe("agent isolation on leads", () => {
    it("agent A sees only their own lead", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ business_name: string }>("select business_name from leads")
      );
      expect(rows.map((r) => r.business_name)).toEqual(["Lead of A"]);
    });

    it("agent B sees only their own lead", async () => {
      const rows = await asUser(client, ids.agentBUserId, (q) =>
        q.rows<{ business_name: string }>("select business_name from leads")
      );
      expect(rows.map((r) => r.business_name)).toEqual(["Lead of B"]);
    });

    it("agent A cannot read agent B's lead by id", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from leads where id = $1", [ids.leadOfB])
      );
      expect(rows).toHaveLength(0);
    });

    it("agent A cannot update agent B's lead", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update leads set business_name = 'HIJACKED' where id = $1", [
          ids.leadOfB,
        ])
      );
      expect(updated).toBe(0);

      // And confirm from a privileged connection that nothing changed.
      const { rows } = await client.query(
        "select business_name from leads where id = $1",
        [ids.leadOfB]
      );
      expect(rows[0].business_name).toBe("Lead of B");
    });

    it("agent A cannot reassign their own lead to agent B", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode("update leads set assigned_to = $1 where id = $2", [
          ids.agentBAgentId,
          ids.leadOfA,
        ])
      );
      // 42501 = insufficient_privilege, raised by the WITH CHECK on the
      // agent update policy.
      expect(code).toBe("42501");
    });

    it("agent A cannot unassign their own lead to orphan it", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode("update leads set assigned_to = null where id = $1", [
          ids.leadOfA,
        ])
      );
      expect(code).toBe("42501");
    });

    it("agent A cannot steal agent B's lead by assigning it to themselves", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update leads set assigned_to = $1 where id = $2", [
          ids.agentAAgentId,
          ids.leadOfB,
        ])
      );
      expect(updated).toBe(0);
    });

    it("agents cannot delete leads at all", async () => {
      const deleted = await asUser(client, ids.agentAUserId, (q) =>
        q.count("delete from leads where id = $1", [ids.leadOfA])
      );
      expect(deleted).toBe(0);
    });

    it("agents cannot insert leads", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into leads (business_name, assigned_to) values ('Sneaky', $1)",
          [ids.agentAAgentId]
        )
      );
      expect(code).toBe("42501");
    });

    it("agent A can update their own lead", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update leads set business_name = 'Renamed by A' where id = $1", [
          ids.leadOfA,
        ])
      );
      expect(updated).toBe(1);
    });

    it("unassigned leads are invisible to agents", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from leads where id = $1", [ids.unassignedLead])
      );
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Admin and non-agent callers
  // -------------------------------------------------------------------------

  describe("admin access", () => {
    it("admin sees every lead", async () => {
      const rows = await asUser(client, ids.adminUserId, (q) =>
        q.rows("select id from leads")
      );
      expect(rows).toHaveLength(3);
    });

    it("admin can reassign a lead between agents", async () => {
      const updated = await asUser(client, ids.adminUserId, (q) =>
        q.count("update leads set assigned_to = $1 where id = $2", [
          ids.agentAAgentId,
          ids.leadOfB,
        ])
      );
      expect(updated).toBe(1);
    });

    it("admin can delete a lead", async () => {
      const deleted = await asUser(client, ids.adminUserId, (q) =>
        q.count("delete from leads where id = $1", [ids.unassignedLead])
      );
      expect(deleted).toBe(1);
    });
  });

  describe("callers without a usable profile", () => {
    it("a deactivated agent sees nothing", async () => {
      const rows = await asUser(client, ids.inactiveUserId, (q) =>
        q.rows("select id from leads")
      );
      expect(rows).toHaveLength(0);
    });

    it("an authenticated user with no agent_profiles row sees nothing", async () => {
      const { rows: created } = await client.query(
        "insert into auth.users (email) values ('stranger@example.com') returning id"
      );
      const rows = await asUser(client, created[0].id, (q) =>
        q.rows("select id from leads")
      );
      expect(rows).toHaveLength(0);
    });

    it("a request carrying no JWT sees nothing", async () => {
      const rows = await asAnon(client, (q) => q.rows("select id from leads"));
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Child records inherit the lead's ownership
  // -------------------------------------------------------------------------

  describe("outreach_sequences scoped through the parent lead", () => {
    beforeAll(async () => {
      await client.query(
        `insert into outreach_sequences (lead_id, channel, subject, body) values
           ($1, 'email', 'To A', 'body'),
           ($2, 'email', 'To B', 'body')`,
        [ids.leadOfA, ids.leadOfB]
      );
    });

    it("agent A sees only sequences on their own lead", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ subject: string }>("select subject from outreach_sequences")
      );
      expect(rows.map((r) => r.subject)).toEqual(["To A"]);
    });

    it("agent A cannot insert a sequence against agent B's lead", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into outreach_sequences (lead_id, channel, body) values ($1, 'email', 'x')",
          [ids.leadOfB]
        )
      );
      expect(code).toBe("42501");
    });

    it("agent A can insert a sequence against their own lead", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into outreach_sequences (lead_id, channel, body) values ($1, 'email', 'x')",
          [ids.leadOfA]
        )
      );
      expect(code).toBeNull();
    });
  });

  describe("activity_log scoped through the parent lead", () => {
    beforeAll(async () => {
      // The app writes entity_type/entity_id, never lead_id — both shapes are
      // seeded here because the policy has to cover both.
      await client.query(
        `insert into activity_log (module, action, entity_type, entity_id, lead_id) values
           ('leads', 'lead.updated', 'lead', $1, null),
           ('leads', 'lead.updated', 'lead', $2, null),
           ('leads', 'legacy.shape',  null,   null, $1),
           ('platform', 'system.event', null, null, null)`,
        [ids.leadOfA, ids.leadOfB]
      );
    });

    it("agent A sees entity_id-linked rows for their lead only", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ action: string }>(
          "select action from activity_log where entity_type = 'lead'"
        )
      );
      expect(rows).toHaveLength(1);
    });

    it("agent A also sees rows linked by the legacy lead_id column", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from activity_log where action = 'legacy.shape'")
      );
      expect(rows).toHaveLength(1);
    });

    it("agent A cannot see module-level rows tied to no lead", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from activity_log where action = 'system.event'")
      );
      expect(rows).toHaveLength(0);
    });

    it("nobody can update the audit trail, not even an admin", async () => {
      // There is no UPDATE policy on activity_log for any role, so the USING
      // clause is false for every row: the statement succeeds but touches
      // nothing. That is what makes the log append-only.
      const updated = await asUser(client, ids.adminUserId, (q) =>
        q.count("update activity_log set action = 'tampered'")
      );
      expect(updated).toBe(0);

      const { rows } = await client.query(
        "select count(*)::int as n from activity_log where action = 'tampered'"
      );
      expect(rows[0].n).toBe(0);
    });
  });

  describe("proposals scoped by creator or lead", () => {
    let proposalOfA: string;
    let proposalOfB: string;
    let orphanProposal: string;

    beforeAll(async () => {
      const { rows } = await client.query(
        `insert into proposals (client_name, created_by, lead_id) values
           ('Prop A', $1, $2),
           ('Prop B', $3, $4),
           ('Orphan', null, null)
         returning id, client_name`,
        [ids.agentAAgentId, ids.leadOfA, ids.agentBAgentId, ids.leadOfB]
      );
      const by = (n: string) =>
        rows.find((r: { client_name: string }) => r.client_name === n).id;
      proposalOfA = by("Prop A");
      proposalOfB = by("Prop B");
      orphanProposal = by("Orphan");
    });

    it("agent A sees their own proposal", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from proposals where id = $1", [proposalOfA])
      );
      expect(rows).toHaveLength(1);
    });

    it("agent A cannot read agent B's proposal or its pricing", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from proposals where id = $1", [proposalOfB])
      );
      expect(rows).toHaveLength(0);
    });

    it("ownerless proposals are admin-only", async () => {
      const agentRows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from proposals where id = $1", [orphanProposal])
      );
      expect(agentRows).toHaveLength(0);

      const adminRows = await asUser(client, ids.adminUserId, (q) =>
        q.rows("select id from proposals where id = $1", [orphanProposal])
      );
      expect(adminRows).toHaveLength(1);
    });

    it("agent A cannot create a proposal attributed to agent B", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into proposals (client_name, created_by) values ('Forged', $1)",
          [ids.agentBAgentId]
        )
      );
      expect(code).toBe("42501");
    });
  });

  // -------------------------------------------------------------------------
  // agent_profiles: own row only, teammate names through the directory view
  // -------------------------------------------------------------------------

  describe("agent_profiles", () => {
    it("agent A reads only their own profile row", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ email: string }>("select email from agent_profiles")
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe("agent-a@tweakandbuild.com");
    });

    it("agent A cannot read agent B's email or role", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from agent_profiles where id = $1", [ids.agentBAgentId])
      );
      expect(rows).toHaveLength(0);
    });

    it("agent A cannot promote themselves to admin", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update agent_profiles set role = 'admin' where id = $1", [
          ids.agentAAgentId,
        ])
      );
      expect(updated).toBe(0);

      const { rows } = await client.query(
        "select role from agent_profiles where id = $1",
        [ids.agentAAgentId]
      );
      expect(rows[0].role).toBe("agent");
    });

    it("agent A cannot deactivate a teammate", async () => {
      const updated = await asUser(client, ids.agentAUserId, (q) =>
        q.count("update agent_profiles set is_active = false where id = $1", [
          ids.agentBAgentId,
        ])
      );
      expect(updated).toBe(0);
    });

    it("agents can read teammate names through agent_directory", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id, display_name from agent_directory")
      );
      // All four seeded profiles are visible by name.
      expect(rows.length).toBeGreaterThanOrEqual(4);
    });

    it("agent_directory exposes no email, role, or user_id column", async () => {
      const cols = await asUser(client, ids.agentAUserId, (q) =>
        q.rows<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'agent_directory'`
        )
      );
      const names = cols.map((c) => c.column_name).sort();
      expect(names).toEqual(["display_name", "id", "is_active"]);
    });

    it("the policies do not recurse when reading agent_profiles", async () => {
      // A recursive policy raises 42P17 (infinite recursion) rather than
      // returning rows. This is the regression guard for querying
      // agent_profiles from inside its own policy.
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode("select id from agent_profiles")
      );
      expect(code).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Config tables and orphaned tables
  // -------------------------------------------------------------------------

  describe("config tables: agents read, admins write", () => {
    it("agents can read outreach_templates", async () => {
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select id from outreach_templates")
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    it("agents cannot write outreach_templates", async () => {
      const code = await asUser(client, ids.agentAUserId, (q) =>
        q.errorCode(
          "insert into outreach_templates (name, channel, body) values ('x', 'email', 'y')"
        )
      );
      expect(code).toBe("42501");
    });

    it("agents cannot delete smart_lists", async () => {
      await client.query(
        "insert into smart_lists (name, filters) values ('All', '{}'::jsonb)"
      );
      const deleted = await asUser(client, ids.agentAUserId, (q) =>
        q.count("delete from smart_lists")
      );
      expect(deleted).toBe(0);
    });
  });

  describe("orphaned tables are admin-only", () => {
    it("agents cannot read site_configs client secrets", async () => {
      await client.query(
        `insert into site_configs (domain, client_secret, openclaw_skill_id, target_email)
         values ('example.com', 'tweak_live_secret', 'skill', 'ops@example.com')`
      );
      const rows = await asUser(client, ids.agentAUserId, (q) =>
        q.rows("select client_secret from site_configs")
      );
      expect(rows).toHaveLength(0);
    });

    it("admins still can", async () => {
      const rows = await asUser(client, ids.adminUserId, (q) =>
        q.rows("select client_secret from site_configs")
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Whole-schema guarantees
  // -------------------------------------------------------------------------

  describe("schema-wide guarantees", () => {
    it("no table in public is left without RLS", async () => {
      const { rows } = await client.query(`
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      `);
      expect(rows.map((r) => r.relname)).toEqual([]);
    });

    it("no policy anywhere evaluates to a bare true", async () => {
      const { rows } = await client.query(`
        select tablename, policyname from pg_policies
        where schemaname = 'public'
          and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')
      `);
      expect(rows).toEqual([]);
    });

    it("every table carries at least one policy", async () => {
      const { rows } = await client.query(`
        select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not exists (
            select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
          )
      `);
      expect(rows.map((r) => r.relname)).toEqual([]);
    });

    it("every private helper pins its search_path", async () => {
      const { rows } = await client.query(`
        select p.proname, p.proconfig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
        order by p.proname
      `);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(
          (row.proconfig as string[] | null)?.some((c) => c.startsWith("search_path=")),
          `private.${row.proname} does not pin search_path`
        ).toBe(true);
      }
    });

    it("the identity and ownership helpers are security definer", async () => {
      // These read tables the caller cannot read directly. That is the point:
      // it is what lets an agent_profiles policy check the caller's role
      // without selecting from agent_profiles and recursing.
      const { rows } = await client.query(`
        select p.proname, p.prosecdef
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and p.proname in ('current_agent_id', 'is_admin', 'owns_lead', 'can_read_deal')
        order by p.proname
      `);
      expect(rows.map((r) => r.proname)).toEqual([
        "can_read_deal",
        "current_agent_id",
        "is_admin",
        "owns_lead",
      ]);
      for (const row of rows) {
        expect(row.prosecdef, `private.${row.proname} is not SECURITY DEFINER`).toBe(true);
      }
    });
  });
});
