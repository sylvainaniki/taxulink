import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { readFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
export type Row = Record<string, any>;
export interface Sql {
  query(sql: string, params?: any[]): Promise<{ rows: Row[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function connect(
  url?: string,
  memory = false,
  role?: "taxilink_app" | "taxilink_identity",
): Promise<Database> {
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    const transaction = async <T>(fn: (q: Sql) => Promise<T>) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        if (role) await c.query("SET LOCAL ROLE " + role);
        const result = await fn(c);
        await c.query("COMMIT");
        return result;
      } catch (error) {
        await c.query("ROLLBACK");
        throw error;
      } finally {
        c.release();
      }
    };
    return {
      query: (s, p) =>
        role ? transaction((q) => q.query(s, p)) : pool.query(s, p),
      transaction,
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
    const files = (await readdir(resolve("db/migrations")))
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const version = Number(file.split("_")[0]);
      if (
        (
          await q.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
            version,
          ])
        ).rows.length
      )
        continue;
      const text = await readFile(resolve("db/migrations", file), "utf8");
      for (const statement of splitSql(text)) {
        const name = statement.match(
          /^CREATE ROLE (taxilink_app|taxilink_identity) /,
        )?.[1];
        if (name) {
          const existing = (
            await q.query(
              "SELECT rolsuper,rolbypassrls,rolcanlogin,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1",
              [name],
            )
          ).rows[0];
          if (existing) {
            if (
              existing.rolsuper ||
              existing.rolbypassrls ||
              existing.rolcanlogin ||
              existing.rolcreatedb ||
              existing.rolcreaterole
            )
              throw new Error(
                "Existing database role has incompatible privileges",
              );
            continue;
          }
        }
        await q.query(statement);
      }
      await q.query("INSERT INTO schema_migrations VALUES($1)", [version]);
    }
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

export function asRole(
  db: Database,
  role: "taxilink_app" | "taxilink_identity",
): Database {
  const transaction = <T>(fn: (q: Sql) => Promise<T>) =>
    db.transaction(async (q) => {
      await q.query("SET LOCAL ROLE " + role);
      return fn(q);
    });
  return {
    query: (s, p) => transaction((q) => q.query(s, p)),
    transaction,
    close: async () => {},
  };
}

export async function assertRuntimePrivileges(
  db: Database,
  identity: Database,
) {
  const app = (
    await db.query(
      "SELECT bool_or(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole) AS elevated,has_table_privilege(session_user,'public.users','SELECT') OR has_table_privilege(current_user,'public.users','SELECT') AS secret_access,pg_has_role(session_user,'taxilink_identity','MEMBER') AS mixed FROM pg_roles r WHERE r.rolname IN (session_user,current_user)",
    )
  ).rows[0];
  const auth = (
    await identity.query(
      "SELECT bool_or(r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole) AS elevated,has_table_privilege(session_user,'public.courses','SELECT') OR has_table_privilege(current_user,'public.courses','SELECT') AS business_access,pg_has_role(session_user,'taxilink_app','MEMBER') AS mixed FROM pg_roles r WHERE r.rolname IN (session_user,current_user)",
    )
  ).rows[0];
  if (
    app.elevated ||
    app.secret_access ||
    app.mixed ||
    auth.elevated ||
    auth.business_access ||
    auth.mixed
  )
    throw new Error(
      "Privileged or mixed database credentials are forbidden in the runtime",
    );
}
