import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { configurationChecks } from "../scripts/doctor";

const local = {
  DEMO_MODE: "true",
  MFA_ENCRYPTION_KEY: "a".repeat(64),
  MAIL_ENCRYPTION_KEY: "b".repeat(64),
};
test("diagnostic accepts the local demo without SMTP or network database", () => {
  assert.ok(configurationChecks(local).every((check) => check.ok));
});
test("diagnostic identifies multiple errors without disclosing supplied secrets", () => {
  const secret = "SECRET-MUST-NOT-APPEAR";
  const checks = configurationChecks({
    DEMO_MODE: "false",
    DATABASE_URL: `postgresql://owner:${secret}@example.test/taxilink`,
    AUTH_DATABASE_URL: `postgresql://owner:${secret}@example.test/taxilink`,
    MFA_ENCRYPTION_KEY: secret,
    MAIL_ENCRYPTION_KEY: secret,
    SMTP_PORT: "70000",
    SMTP_FROM: secret,
    PUBLIC_REGISTRATION_ENABLED: "true",
    REAL_SENSITIVE_DOCUMENTS_ENABLED: "true",
  });
  for (const id of [
    "runtime",
    "documents",
    "invitations",
    "MFA_ENCRYPTION_KEY",
    "distinct-keys",
    "database-identities",
    "mail-port",
    "mail-from",
  ])
    assert.equal(checks.find((check) => check.id === id)?.ok, false, id);
  assert.ok(!JSON.stringify(checks).includes(secret));
});
test("diagnostic CLI returns machine readable failure and never prints malformed URL values", () => {
  const secret = "SECRET-DATABASE-VALUE";
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/doctor.ts", "--json"],
    {
      env: {
        ...process.env,
        ...local,
        DEMO_MODE: "false",
        DATABASE_URL: secret,
        AUTH_DATABASE_URL: secret,
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
});
