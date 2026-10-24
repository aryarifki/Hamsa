import { randomUUID } from "node:crypto";
import { Pool, types, type PoolClient } from "pg";

/**
 * PostgreSQL access layer.
 *
 * The app talks raw SQL through three helpers (`one`, `all`, `run`) plus a
 * transaction wrapper. Two deliberate conveniences keep the call sites small:
 *
 *  1. `?` placeholders are rewritten to `$1..$n` by `toPg()`. The queries were
 *     written against the previous engine; keeping the marker stable means a
 *     review can focus on behaviour rather than 150 mechanical edits. Do not
 *     use the Postgres `?` JSON operator in raw SQL — use `jsonb_exists()`.
 *  2. `timestamptz` is parsed back to an ISO-8601 UTC string, so every existing
 *     `a < b` comparison and `new Date(value)` keeps working unchanged.
 */

types.setTypeParser(1184, (value) => new Date(value).toISOString()); // timestamptz → ISO
types.setTypeParser(1114, (value) => new Date(`${value}Z`).toISOString()); // timestamp → ISO
types.setTypeParser(20, (value) => Number(value)); // int8 (`COUNT(*)`) → number
types.setTypeParser(1700, (value) => Number(value)); // numeric (`SUM(...)`) → number

export interface Query {
  one<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
}

export interface Db extends Query {
  /** Multi-statement DDL, no parameters. */
  exec(sql: string): Promise<void>;
}

export const newId = (): string => randomUUID();
export const now = (): string => new Date().toISOString();

/** Rewrites `?` placeholders to `$n`, ignoring quoted strings/identifiers. */
export function toPg(sql: string): string {
  let out = "";
  let index = 0;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];

    if (quote) {
      out += char;
      if (char === quote) {
        if (sql[i + 1] === quote) {
          out += sql[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }

    if (char === "?") {
      index += 1;
      out += `$${index}`;
      continue;
    }

    out += char;
  }

  return out;
}

interface Runner {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

function makeDb(runner: Runner): Db {
  const exec = async (sql: string): Promise<void> => {
    // No parameter array: node-postgres uses the simple protocol, which allows
    // several statements separated by semicolons.
    await runner.query(sql);
  };

  const query = (sql: string, params: unknown[]) => runner.query(toPg(sql), params);

  return {
    exec,
    async one<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const result = await query(sql, params);
      return result.rows[0] as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const result = await query(sql, params);
      return result.rows as T[];
    },
    async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
      const result = await query(sql, params);
      return { changes: result.rowCount ?? 0 };
    },
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __hamsaPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __hamsaSchema: Promise<void> | undefined;
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Hamsa requires PostgreSQL — see README § Setup (postgres://user:pass@host:5432/hamsa).",
    );
  }

  if (!globalThis.__hamsaPool) {
    const pool = new Pool({
      connectionString,
      max: Number(process.env.HAMSA_PG_POOL ?? 10),
      application_name: "hamsa",
    });
    pool.on("error", (err) => console.error("[db] idle client error:", err.message));
    globalThis.__hamsaPool = pool;
  }

  return globalThis.__hamsaPool;
}

/** A `Db` bound to a dedicated client (transactions, migrations, tests). */
export function clientDb(client: PoolClient): Db {
  return makeDb(client);
}

/** The process-wide pool, created lazily on first use. */
export function poolDb(): Db {
  return makeDb(getPool());
}

export const db: Db = {
  one: (sql, ...params) => poolDb().one(sql, ...params),
  all: (sql, ...params) => poolDb().all(sql, ...params),
  run: (sql, ...params) => poolDb().run(sql, ...params),
  exec: (sql) => poolDb().exec(sql),
};

export const one = db.one;
export const all = db.all;
export const run = db.run;

/** Runs `fn` on one client without opening a transaction. */
export async function withClient<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(clientDb(client));
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` inside a transaction on a single client. Every query in the
 * callback must go through the provided `Db`; the process-wide helpers would
 * take a different connection and escape the transaction.
 */
export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(clientDb(client));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA_LOCK = 741_852_963;

/**
 * Applies the baseline schema and every pending migration. Cached per process
 * and guarded by an advisory lock so several Next workers booting at once do
 * not race each other through the migration table.
 */
export function ensureSchema(): Promise<void> {
  if (!globalThis.__hamsaSchema) {
    globalThis.__hamsaSchema = withClient(async (client) => {
      await client.exec(`SELECT pg_advisory_lock(${SCHEMA_LOCK})`);
      try {
        const { SCHEMA } = await import("./schema");
        const { applyMigrations } = await import("./migrations");
        await client.exec(SCHEMA);
        await applyMigrations(client);
      } finally {
        await client.exec(`SELECT pg_advisory_unlock(${SCHEMA_LOCK})`).catch(() => undefined);
      }
    }).catch((err) => {
      globalThis.__hamsaSchema = undefined;
      throw err;
    });
  }

  return globalThis.__hamsaSchema;
}

/**
 * Drops every row. Test-only: guarded so it can never run in production by
 * accident.
 */
export async function resetDatabase(): Promise<void> {
  if (process.env.NODE_ENV !== "test" && process.env.HAMSA_ALLOW_DB_RESET !== "true") {
    throw new Error("resetDatabase() is only available with NODE_ENV=test or HAMSA_ALLOW_DB_RESET=true");
  }
  await ensureSchema();
  await db.exec(`
    TRUNCATE TABLE
      notifications, camera_events, camera_snapshots, cameras,
      geofence_events, device_locations, geofences, tracked_devices,
      watchlist, api_keys, case_items, cases, lookups, ledger, sessions,
      audit_log, providers, settings, telegram_sources, users
    RESTART IDENTITY CASCADE;
  `);
}

export async function closePool(): Promise<void> {
  if (globalThis.__hamsaPool) {
    const pool = globalThis.__hamsaPool;
    globalThis.__hamsaPool = undefined;
    globalThis.__hamsaSchema = undefined;
    await pool.end();
  }
}
