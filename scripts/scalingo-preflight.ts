import pg from "pg";
import nodemailer from "nodemailer";

// One-time diagnostic build only. No migrations, grants, account creation or mail.
// Values, database usernames and raw provider errors must never enter build logs.
async function main() {
  console.log(
    "TAXILINK: diagnostic-only build; application startup is disabled.",
  );
  if (process.env.DEMO_MODE !== "false")
    throw new Error("Operational configuration required");
  const value = process.env.SCALINGO_POSTGRESQL_URL;
  if (!value) throw new Error("Platform database connection unavailable");
  const connection = new URL(value);
  connection.searchParams.set("sslmode", "verify-full");
  const client = new pg.Client({
    connectionString: connection.toString(),
    connectionTimeoutMillis: 15000,
    statement_timeout: 10000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const row = (
      await client.query(
        "SELECT r.rolsuper,r.rolcreaterole,r.rolbypassrls,has_schema_privilege(current_user,'public','CREATE') AS schema_create,current_setting('server_version_num') AS version FROM pg_roles r WHERE r.rolname=current_user",
      )
    ).rows[0];
    console.log(
      "Database capabilities: " +
        JSON.stringify({
          version: Number(row.version),
          superuser: row.rolsuper,
          createRole: row.rolcreaterole,
          bypassRls: row.rolbypassrls,
          createSchemaObjects: row.schema_create,
        }),
    );
    await client.query("ROLLBACK");
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.log(
      "Database check failed: " +
        (code === "28P01"
          ? "authentication"
          : code === "42501"
            ? "permissions"
            : "connection, TLS or query unavailable"),
    );
  } finally {
    await client.end().catch(() => {});
  }
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASSWORD
  ) {
    console.log("SMTP check: configuration incomplete");
  } else {
    const port = Number(process.env.SMTP_PORT || 587);
    const mail = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000,
      logger: false,
      debug: false,
    });
    try {
      await mail.verify();
      console.log("SMTP check: authenticated successfully; no email sent");
    } catch (error) {
      console.log(
        "SMTP check failed: " +
          ((error as { code?: string }).code === "EAUTH"
            ? "authentication"
            : "connection or TLS unavailable"),
      );
    } finally {
      mail.close();
    }
  }
  console.log(
    "PREFLIGHT_COMPLETE: no database mutation, no email, no web container started. Build intentionally stopped.",
  );
  process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Preflight configuration unavailable; no secret values logged.",
  );
  process.exitCode = 1;
});
