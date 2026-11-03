import pg from "pg";
import { connect, migrate } from "../apps/api/src/db";
import { seed } from "../apps/api/src/seed";
export async function provision(
  url: string,
  apiPassword: string,
  identityPassword: string,
) {
  if (!/^postgres(ql)?:\/\//.test(url))
    throw new Error("MIGRATION_DATABASE_URL must point to PostgreSQL");
  for (const value of [apiPassword, identityPassword])
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(value))
      throw new Error(
        "Runtime database passwords must be 32–128 URL-safe characters",
      );
  const db = await connect(url);
  try {
    await migrate(db);
    await db.transaction(async (q) => {
      for (const [user, role, password] of [
        ["taxilink_api", "taxilink_app", apiPassword],
        ["taxilink_auth", "taxilink_identity", identityPassword],
      ]) {
        const exists = (
          await q.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [user])
        ).rows.length;
        await q.query(
          `${exists ? "ALTER" : "CREATE"} ROLE ${pg.escapeIdentifier(user)} LOGIN PASSWORD ${pg.escapeLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
        );
        await q.query(`GRANT ${role} TO ${pg.escapeIdentifier(user)}`);
      }
    });
    if (process.env.DEMO_MODE === "true" && process.env.DEMO_PASSWORD)
      await seed(
        db,
        process.env.DEMO_PASSWORD,
        process.env.DEMO_DATE || "2026-11-04",
      );
  } finally {
    await db.close();
  }
}
if (process.argv[1]?.endsWith("/provision.ts"))
  provision(
    process.env.MIGRATION_DATABASE_URL || "",
    process.env.API_DB_PASSWORD || "",
    process.env.AUTH_DB_PASSWORD || "",
  )
    .then(() =>
      console.log("Migrations and restricted database identities configured."),
    )
    .catch(() => {
      console.error(
        "Provisioning failed. Check migration access and URL-safe runtime passwords.",
      );
      process.exitCode = 1;
    });
