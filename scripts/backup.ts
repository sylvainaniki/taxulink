import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { connect, migrate } from "../apps/api/src/db";
import { backup, restore } from "../apps/api/src/backup";
async function main() {
  const [operation, file] = process.argv.slice(2);
  if (!["create", "restore"].includes(operation) || !file)
    throw new Error(
      "Usage: node --import tsx scripts/backup.ts create|restore PATH.tlbackup",
    );
  const key = process.env.BACKUP_PASSPHRASE || "";
  if (key.length < 32)
    throw new Error("BACKUP_PASSPHRASE must contain at least 32 characters");
  if (operation === "restore" && process.env.CONFIRM_EMPTY_RESTORE !== "true")
    throw new Error(
      "Set CONFIRM_EMPTY_RESTORE=true for a new, empty database only",
    );
  const db = await connect(
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  );
  try {
    await migrate(db);
    if (operation === "create") {
      const bytes = await backup(db, key);
      await mkdir(dirname(resolve(file)), { recursive: true });
      await writeFile(resolve(file), bytes, { mode: 0o600, flag: "wx" });
      console.log(
        "Encrypted backup created. Preserve the passphrase separately.",
      );
    } else {
      await restore(db, key, await readFile(resolve(file)));
      console.log("Restore completed. All users must sign in again.");
    }
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
