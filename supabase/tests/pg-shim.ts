import { Client, types } from "pg";

/**
 * A minimal stand-in for the Supabase JS query builder, backed by node-postgres.
 *
 * The point is to run the *real* engine code (src/lib/commissions/*) against a
 * real database. Re-implementing the writers in the test would only prove the
 * test agrees with itself; this way the same functions that ship are the ones
 * under test, including their error handling and their reliance on Postgres
 * error codes.
 *
 * It implements only the surface those modules actually use. Anything else
 * throws loudly rather than silently returning nothing, so a new call pattern
 * shows up as a failing test rather than a passing one that checked nothing.
 */

// Match what the real client hands the application, because the engine's
// behaviour depends on it:
//
//   int8  — PostgREST emits a JSON number, node-postgres a string. Left as a
//           string, every `total + amount_cents` would silently concatenate.
//   timestamptz — PostgREST emits an ISO 8601 string, node-postgres a Date.
//           balances.ts compares payable_at against an ISO string, and a Date
//           compared to a string coerces through toString() and gives nonsense.
//
// Getting these wrong makes the shim pass where production would fail, which
// is worse than not having the tests at all.
types.setTypeParser(types.builtins.INT8, (v) => Number.parseInt(v, 10));
types.setTypeParser(types.builtins.NUMERIC, (v) => Number.parseFloat(v));
types.setTypeParser(types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
types.setTypeParser(types.builtins.TIMESTAMP, (v) => new Date(v + "Z").toISOString());

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "is"; column: string; value: null }
  | { kind: "notIs"; column: string; value: null }
  | { kind: "gte"; column: string; value: unknown }
  | { kind: "lte"; column: string; value: unknown };

export interface ShimError {
  code?: string;
  message: string;
}

export interface ShimResult<T = Record<string, unknown>> {
  data: T | null;
  error: ShimError | null;
  count?: number | null;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** "id, deal_id, amount_cents" -> quoted column list. `*` passes through. */
function selectList(columns: string): string {
  const trimmed = columns.trim();
  if (trimmed === "*" || trimmed === "") return "*";
  return trimmed
    .split(",")
    .map((c) => quoteIdent(c.trim()))
    .join(", ");
}

class QueryBuilder<T = Record<string, unknown>> implements PromiseLike<ShimResult<T>> {
  private filters: Filter[] = [];
  private columns = "*";
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private wantSingle: "single" | "maybeSingle" | null = null;
  private countMode: "exact" | null = null;
  private headMode = false;
  private returning = false;

  constructor(
    private client: Client,
    private table: string,
    private op: "select" | "insert" | "update" | "delete",
    private payload?: Record<string, unknown>
  ) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }): this {
    this.columns = columns;
    this.returning = true;
    if (options?.count) this.countMode = options.count;
    if (options?.head) this.headMode = true;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  is(column: string, value: null): this {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  not(column: string, operator: string, value: null): this {
    if (operator !== "is" || value !== null) {
      throw new Error(`pg-shim: unsupported .not(${column}, ${operator}, ...)`);
    }
    this.filters.push({ kind: "notIs", column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  single(): this {
    this.wantSingle = "single";
    this.returning = true;
    return this;
  }

  maybeSingle(): this {
    this.wantSingle = "maybeSingle";
    this.returning = true;
    return this;
  }

  private buildWhere(params: unknown[]): string {
    if (this.filters.length === 0) return "";
    const clauses = this.filters.map((f) => {
      const col = quoteIdent(f.column);
      switch (f.kind) {
        case "is":
          return `${col} is null`;
        case "notIs":
          return `${col} is not null`;
        case "eq":
          params.push(f.value);
          return `${col} = $${params.length}`;
        case "gte":
          params.push(f.value);
          return `${col} >= $${params.length}`;
        case "lte":
          params.push(f.value);
          return `${col} <= $${params.length}`;
      }
    });
    return ` where ${clauses.join(" and ")}`;
  }

  private buildSql(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const table = quoteIdent(this.table);

    if (this.op === "select") {
      const projection = this.countMode
        ? "count(*)::int as __count"
        : selectList(this.columns);
      let sql = `select ${projection} from ${table}${this.buildWhere(params)}`;
      if (!this.countMode) {
        if (this.orderBy) {
          sql += ` order by ${quoteIdent(this.orderBy.column)} ${
            this.orderBy.ascending ? "asc" : "desc"
          }`;
        }
        if (this.limitN !== null) sql += ` limit ${this.limitN}`;
      }
      return { sql, params };
    }

    if (this.op === "insert") {
      const entries = Object.entries(this.payload ?? {});
      const cols = entries.map(([k]) => quoteIdent(k)).join(", ");
      const placeholders = entries
        .map(([, v]) => {
          params.push(v);
          return `$${params.length}`;
        })
        .join(", ");
      const sql =
        `insert into ${table} (${cols}) values (${placeholders})` +
        (this.returning ? ` returning ${selectList(this.columns)}` : "");
      return { sql, params };
    }

    if (this.op === "update") {
      const entries = Object.entries(this.payload ?? {});
      const sets = entries
        .map(([k, v]) => {
          params.push(v);
          return `${quoteIdent(k)} = $${params.length}`;
        })
        .join(", ");
      const sql =
        `update ${table} set ${sets}${this.buildWhere(params)}` +
        (this.returning ? ` returning ${selectList(this.columns)}` : "");
      return { sql, params };
    }

    return {
      sql: `delete from ${table}${this.buildWhere(params)}`,
      params,
    };
  }

  async run(): Promise<ShimResult<T>> {
    const { sql, params } = this.buildSql();

    try {
      const res = await this.client.query(sql, params);

      if (this.countMode) {
        const count = (res.rows[0]?.__count as number) ?? 0;
        return { data: (this.headMode ? null : ([] as unknown as T)), error: null, count };
      }

      if (this.wantSingle) {
        const row = (res.rows[0] ?? null) as T | null;
        if (!row && this.wantSingle === "single") {
          // PostgREST's code for "expected one row, got none".
          return { data: null, error: { code: "PGRST116", message: "no rows returned" } };
        }
        return { data: row, error: null };
      }

      return { data: res.rows as unknown as T, error: null };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return {
        data: null,
        error: { code: e.code, message: e.message ?? String(err) },
      };
    }
  }

  then<R1 = ShimResult<T>, R2 = never>(
    onfulfilled?: ((value: ShimResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

class TableRef {
  constructor(
    private client: Client,
    private table: string
  ) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    return new QueryBuilder(this.client, this.table, "select").select(columns, options);
  }

  insert(payload: Record<string, unknown>) {
    return new QueryBuilder(this.client, this.table, "insert", payload);
  }

  update(payload: Record<string, unknown>) {
    return new QueryBuilder(this.client, this.table, "update", payload);
  }

  delete() {
    return new QueryBuilder(this.client, this.table, "delete");
  }
}

/**
 * Wrap a pg Client in something the commission modules will accept as a
 * SupabaseClient. Cast at the boundary: this implements the used subset, not
 * the full interface.
 */
export function makePgSupabaseShim(client: Client) {
  return {
    from(table: string) {
      return new TableRef(client, table);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
