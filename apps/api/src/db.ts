import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
export type Row = Record<string, any>;
export interface Sql {
  query(sql: string, params?: any[]): Promise<{ rows: Row[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function connect(url?: string, memory = false): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    return {
      query: (s, p) => pool.query(s, p),
      async transaction(fn) {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const r = await fn(c);
          await c.query("COMMIT");
          return r;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (!memory) await mkdir(resolve(".data"), { recursive: true });
  const db = new PGlite(memory ? undefined : resolve(".data/demo"));
  await db.waitReady;
  return {
    query: (s, p) => db.query(s, p),
    transaction: (fn) => db.transaction((tx) => fn(tx)),
    close: () => db.close(),
  };
}
export async function migrate(db: Database) {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)",
  );
  await db.transaction(async (q) => {
    await q.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    if (
      (await q.query("SELECT 1 FROM schema_migrations WHERE version=1")).rows
        .length
    )
      return;
    // Multi-statement migrations are split by the database simple-query interface.
    const text = await readFile(
      resolve("db/migrations/001_foundation.sql"),
      "utf8",
    );
    // PGlite query accepts one statement only; exec via parsed dollar blocks below.
    for (const sql of splitSql(text)) await q.query(sql);
    await q.query("INSERT INTO schema_migrations VALUES (1)");
  });
}
function splitSql(text: string) {
  const pieces: string[] = [];
  let start = 0;
  let dollar = false;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (!quoted && text.slice(i, i + 2) === "$$") {
      dollar = !dollar;
      i++;
      continue;
    }
    if (!dollar && text[i] === "'") {
      if (quoted && text[i + 1] === "'") {
        i++;
        continue;
      }
      quoted = !quoted;
    }
    if (text[i] === ";" && !dollar && !quoted) {
      const s = text.slice(start, i).trim();
      if (s) pieces.push(s);
      start = i + 1;
    }
  }
  const rest = text.slice(start).trim();
  if (rest) pieces.push(rest);
  return pieces;
}
export async function scoped<T>(
  db: Database,
  tenant: string,
  fn: (q: Sql) => Promise<T>,
) {
  return db.transaction(async (q) => {
    await q.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    await q.query("SET LOCAL ROLE taxilink_app");
    return fn(q);
  });
}
