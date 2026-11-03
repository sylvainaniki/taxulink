import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
async function main() {
  const token = () => randomBytes(32).toString("base64url");
  const text = [
    "DEMO_MODE=true",
    "DEMO_PASSWORD=" + token(),
    "DB_PASSWORD=" + token(),
    "API_DB_PASSWORD=" + token(),
    "AUTH_DB_PASSWORD=" + token(),
    "MFA_ENCRYPTION_KEY=" + randomBytes(32).toString("hex"),
    "BACKUP_PASSPHRASE=" + token(),
    "PORT=4000",
    "WEB_ORIGIN=http://localhost:3000",
    "DATABASE_URL=",
    "AUTH_DATABASE_URL=",
    "MIGRATION_DATABASE_URL=",
    "REAL_SENSITIVE_DOCUMENTS_ENABLED=false",
    "",
  ].join("\n");
  await writeFile(".env", text, { mode: 0o600, flag: "wx" });
  console.log(
    "Configuration created in .env with unique local secrets. Read the demo password locally; keep this file private.",
  );
}
main().catch(() => {
  console.error(
    "Configuration was not replaced. If .env exists, preserve it and fill any missing settings manually.",
  );
  process.exitCode = 1;
});
