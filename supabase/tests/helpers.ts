import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const BOOTSTRAP = path.resolve(__dirname, "bootstrap.sql");

/**
 * Connection string for the throwaway Postgres the RLS suite runs against.
 * When unset the suite skips rather than fails, so `npm test` still works on a
 * machine with no database. CI sets it against a postgres service.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

export const hasTestDatabase = TEST_DATABASE_URL.length > 0;

/**
 * Connect to a database dedicated to one test file.
 *
 * Each DB suite drops and rebuilds the whole `public` schema, so two of them
 * sharing a database will corrupt each other whenever Vitest runs their files
 * in parallel. Giving each suite its own database keeps them isolated without
 * having to serialise the whole test run.
 *
 * Pass a short suite name; omit it to use the database named in the URL.
 */
export async function connect(suite?: string): Promise<Client> {
  if (!suite) {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    return client;
  }

  const url = new URL(TEST_DATABASE_URL);
  const baseName = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
  const dbName = `${baseName}_${suite}`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 63);

  // Create the per-suite database from a connection to the base one. FORCE
  // (PG13+) evicts any connection left behind by an interrupted run.
  const admin = new Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${quoteIdent(dbName)} with (force)`);
    await admin.query(`create database ${quoteIdent(dbName)}`);
  } finally {
    await admin.end();
  }

  url.pathname = `/${dbName}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

/** Identifiers here are derived from our own config, but quote them anyway. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Rebuild the schema from scratch: Supabase scaffolding, then every migration
 * in order. Running the real migration files (rather than a hand-maintained
 * fixture) is the point — it means these tests exercise the policies that
 * actually ship.
 */
export async function resetSchema(client: Client): Promise<void> {
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists private cascade;
    drop schema if exists auth cascade;
    create schema public;
  `);

  await client.query(readFileSync(BOOTSTRAP, "utf8"));

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query(sql);
    } catch (err) {
      throw new Error(
        `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export interface SeedIds {
  adminUserId: string;
  adminAgentId: string;
  agentAUserId: string;
  agentAAgentId: string;
  agentBUserId: string;
  agentBAgentId: string;
  inactiveUserId: string;
  leadOfA: string;
  leadOfB: string;
  unassignedLead: string;
}

/**
 * One admin, two active agents, one deactivated agent, and a lead assigned to
 * each active agent plus one unassigned. Seeded as the table owner so RLS does
 * not interfere with setup.
 */
export async function seed(client: Client): Promise<SeedIds> {
  await client.query(`
    with u as (
      insert into auth.users (email) values
        ('admin@tweakandbuild.com'),
        ('agent-a@tweakandbuild.com'),
        ('agent-b@tweakandbuild.com'),
        ('inactive@tweakandbuild.com')
      returning id, email
    )
    insert into public.agent_profiles (user_id, display_name, email, role, is_active)
    select
      u.id,
      u.email,
      u.email,
      case when u.email like 'admin@%' then 'admin' else 'agent' end,
      u.email not like 'inactive@%'
    from u
  `);

  const { rows: profiles } = await client.query<{
    id: string;
    user_id: string;
    email: string;
  }>("select id, user_id, email from public.agent_profiles");

  const profile = (prefix: string) => {
    const found = profiles.find((p) => p.email.startsWith(prefix));
    if (!found) throw new Error(`seed: no agent_profiles row for ${prefix}`);
    return found;
  };

  const admin = profile("admin@");
  const agentA = profile("agent-a@");
  const agentB = profile("agent-b@");
  const inactive = profile("inactive@");

  const { rows: leads } = await client.query<{
    id: string;
    business_name: string;
  }>(
    `insert into public.leads (business_name, assigned_to) values
       ('Lead of A', $1), ('Lead of B', $2), ('Unassigned Lead', null)
     returning id, business_name`,
    [agentA.id, agentB.id]
  );

  const lead = (name: string) => {
    const found = leads.find((l) => l.business_name === name);
    if (!found) throw new Error(`seed: no lead named ${name}`);
    return found.id;
  };

  return {
    adminUserId: admin.user_id,
    adminAgentId: admin.id,
    agentAUserId: agentA.user_id,
    agentAAgentId: agentA.id,
    agentBUserId: agentB.user_id,
    agentBAgentId: agentB.id,
    inactiveUserId: inactive.user_id,
    leadOfA: lead("Lead of A"),
    leadOfB: lead("Lead of B"),
    unassignedLead: lead("Unassigned Lead"),
  };
}

/**
 * Run `fn` the way a real PostgREST request runs: as the `authenticated` role
 * with request.jwt.claims carrying the user's sub. Everything happens inside a
 * transaction that is always rolled back, so tests cannot leak into each other.
 *
 * `set local role` is what makes these tests meaningful — as the superuser
 * that owns the tables, RLS would be bypassed entirely and every assertion
 * would pass vacuously.
 */
export async function asUser<T>(
  client: Client,
  userId: string,
  fn: (q: Querier) => Promise<T>
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [userId]
    );
    await client.query("set local role authenticated");
    return await fn(makeQuerier(client));
  } finally {
    await client.query("rollback");
  }
}

/** Same, but with no JWT at all — an unauthenticated caller. */
export async function asAnon<T>(
  client: Client,
  fn: (q: Querier) => Promise<T>
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`select set_config('request.jwt.claims', '', true)`);
    await client.query("set local role authenticated");
    return await fn(makeQuerier(client));
  } finally {
    await client.query("rollback");
  }
}

export interface Querier {
  rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Row count actually affected — the honest measure of an RLS-filtered write. */
  count(sql: string, params?: unknown[]): Promise<number>;
  /** Resolves to the Postgres error code, or null when the statement succeeded. */
  errorCode(sql: string, params?: unknown[]): Promise<string | null>;
}

function makeQuerier(client: Client): Querier {
  return {
    async rows<T>(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params);
      return res.rows as T[];
    },
    async count(sql: string, params: unknown[] = []) {
      const res = await client.query(sql, params);
      return res.rowCount ?? 0;
    },
    async errorCode(sql: string, params: unknown[] = []) {
      // Savepoint so a rejected statement does not abort the surrounding
      // transaction and take every later assertion down with it.
      await client.query("savepoint stmt");
      try {
        await client.query(sql, params);
        await client.query("release savepoint stmt");
        return null;
      } catch (err) {
        await client.query("rollback to savepoint stmt");
        return (err as { code?: string }).code ?? "unknown";
      }
    },
  };
}
