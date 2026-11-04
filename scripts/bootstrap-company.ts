import { randomUUID } from "node:crypto";
import { z } from "zod";
import { connect, type Database } from "../apps/api/src/db";
import { passwordHash } from "../apps/api/src/security";

// Administrative one-off only. Never invoke from a web route or seed real data.
export async function bootstrapCompany(db: Database, data: unknown) {
  const d = z
    .object({
      email: z.email(),
      password: z.string().min(16).max(128),
      company: z.string().trim().min(2).max(100),
    })
    .strict()
    .parse(data);
  return db.transaction(async (q) => {
    await q.query("SELECT id FROM collaboration_lock WHERE id=1 FOR UPDATE");
    if (
      (
        await q.query("SELECT 1 FROM users WHERE email=$1", [
          d.email.toLowerCase(),
        ])
      ).rows.length
    )
      throw new Error("ACCOUNT_EXISTS");
    const user = randomUUID(),
      tenant = randomUUID();
    if (
      !(await q.query("SELECT pilot_has_capacity($1,10) AS allowed", [user]))
        .rows[0].allowed
    )
      throw new Error("PILOT_USER_LIMIT");
    await q.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)",
      [user, d.email.toLowerCase(), passwordHash(d.password)],
    );
    await q.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [
      tenant,
      d.company,
    ]);
    await q.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
      [tenant, user],
    );
    await q.query(
      "INSERT INTO audit_events(id,tenant_id,actor_id,action,object_id) VALUES($1,$2,$3,'company.bootstrapped',$2)",
      [randomUUID(), tenant, user],
    );
    return { user_id: user, tenant_id: tenant };
  });
}
async function main() {
  if (!/^postgres(ql)?:\/\//.test(process.env.MIGRATION_DATABASE_URL || ""))
    throw new Error("A PostgreSQL migration connection is required");
  const db = await connect(process.env.MIGRATION_DATABASE_URL);
  try {
    await bootstrapCompany(db, {
      email: process.env.BOOTSTRAP_ADMIN_EMAIL,
      password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
      company: process.env.BOOTSTRAP_COMPANY,
    });
    console.log(
      "Company administrator created. Email verification and MFA enrollment remain required.",
    );
  } catch {
    console.error(
      "Company bootstrap failed; no credentials or personal data are logged.",
    );
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith("/bootstrap-company.ts"))
  main().catch(() => {
    console.error("Company bootstrap configuration failed.");
    process.exitCode = 1;
  });
