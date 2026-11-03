import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import type { Database } from "./db";
import { migrate } from "./db";
import { requireThat } from "./security";
const tables = [
  "tenants",
  "users",
  "memberships",
  "locations",
  "routes",
  "drivers",
  "vehicles",
  "contacts",
  "courses",
  "assignments",
  "invitations",
  "partner_groups",
  "group_members",
  "group_invitations",
  "offers",
  "offer_targets",
  "resource_holds",
  "notifications",
  "messages",
  "conversations",
  "conversation_members",
  "private_messages",
  "planning_proposals",
  "recurrences",
  "driver_shifts",
  "assignment_history",
  "operational_alerts",
  "audit_events",
];
export async function backup(db: Database, passphrase: string) {
  requireThat(passphrase.length >= 32, 400, "BACKUP_KEY_TOO_SHORT");
  const data = await db.transaction(async (q) => {
    // All writes use this same lock; the snapshot cannot mix planning versions.
    await q.query("LOCK TABLE schema_migrations IN SHARE MODE");
    await q.query("SELECT id FROM collaboration_lock WHERE id=1 FOR UPDATE");
    const result: Record<string, any[]> = {};
    for (const table of tables)
      result[table] = (
        await q.query(
          `SELECT * FROM ${table} ${table === "courses" ? "ORDER BY source_course_id NULLS FIRST, return_of NULLS FIRST, id" : ""}`,
        )
      ).rows;
    return {
      format: 1,
      created_at: new Date().toISOString(),
      versions: (
        await q.query("SELECT version FROM schema_migrations ORDER BY version")
      ).rows.map((r) => r.version),
      tables: result,
    };
  });
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = scryptSync(passphrase, salt, 32),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    encrypted = Buffer.concat([
      cipher.update(JSON.stringify(data), "utf8"),
      cipher.final(),
    ]);
  const payload = Buffer.concat([
    Buffer.from("TLB1"),
    salt,
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]);
  requireThat(payload.length <= 50 * 1024 * 1024, 413, "BACKUP_TOO_LARGE");
  return payload;
}
export async function restore(
  db: Database,
  passphrase: string,
  payload: Buffer,
) {
  requireThat(
    payload.length >= 48 &&
      payload.length <= 50 * 1024 * 1024 &&
      payload.subarray(0, 4).toString() === "TLB1",
    400,
    "BACKUP_INVALID",
  );
  requireThat(passphrase.length >= 32, 400, "BACKUP_KEY_TOO_SHORT");
  let data: any;
  try {
    const key = scryptSync(passphrase, payload.subarray(4, 20), 32),
      decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(20, 32));
    decipher.setAuthTag(payload.subarray(32, 48));
    data = JSON.parse(
      Buffer.concat([
        decipher.update(payload.subarray(48)),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new Error("BACKUP_AUTHENTICATION_FAILED");
  }
  requireThat(
    data.format === 1 &&
      Object.keys(data.tables || {}).length === tables.length &&
      tables.every((t) => Array.isArray(data.tables[t])),
    400,
    "BACKUP_INVALID",
  );
  await migrate(db);
  await db.transaction(async (q) => {
    await q.query("SELECT id FROM collaboration_lock WHERE id=1 FOR UPDATE");
    requireThat(
      !(await q.query("SELECT 1 FROM tenants LIMIT 1")).rows.length,
      409,
      "RESTORE_REQUIRES_EMPTY_DATABASE",
    );
    const versions = (
      await q.query("SELECT version FROM schema_migrations ORDER BY version")
    ).rows.map((r) => r.version);
    requireThat(
      JSON.stringify(data.versions) === JSON.stringify(versions),
      409,
      "BACKUP_VERSION_MISMATCH",
    );
    for (const table of tables) {
      const columns = (
        await q.query(
          "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          [table],
        )
      ).rows;
      const names = columns.map((c) => c.column_name);
      for (const row of data.tables[table]) {
        requireThat(
          Object.keys(row).every((c) => names.includes(c)),
          400,
          "BACKUP_COLUMNS_INVALID",
        );
        const values = columns.map((c) =>
          c.data_type === "jsonb"
            ? JSON.stringify(row[c.column_name])
            : row[c.column_name],
        );
        await q.query(
          `INSERT INTO ${table} (${names.map((n) => '"' + n + '"').join(",")}) VALUES (${values.map((_, i) => "$" + (i + 1)).join(",")})`,
          values,
        );
      }
    }
    // Sessions and request replay caches are deliberately not restored.
  });
}
