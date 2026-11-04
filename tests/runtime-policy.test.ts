import { test } from "node:test";
import assert from "node:assert/strict";
import { runtimePolicy } from "../apps/api/src/runtime-policy";
import { bootstrapCompany } from "../scripts/bootstrap-company";
import { connect, migrate } from "../apps/api/src/db";

const operational = {
  DEMO_MODE: "false",
  OPERATIONAL_PILOT_ENABLED: "true",
  DATABASE_URL: "postgresql://synthetic-business",
  AUTH_DATABASE_URL: "postgresql://synthetic-identity",
  SMTP_HOST: "synthetic.invalid",
  SMTP_FROM: "accounts@example.test",
  WEB_ORIGIN: "https://synthetic.example.test",
  COOKIE_SECURE: "true",
  REQUIRE_VERIFIED_EMAIL: "true",
  MFA_ENCRYPTION_KEY: "a".repeat(64),
  MAIL_ENCRYPTION_KEY: "b".repeat(64),
};
test("hosted operational startup refuses incomplete or weakened configuration and keeps documents outside scope", () => {
  assert.deepEqual(runtimePolicy({ DEMO_MODE: "true" }), { demo: true });
  assert.throws(() => runtimePolicy({}), /not enabled/);
  assert.deepEqual(runtimePolicy(operational), { demo: false });
  for (const key of [
    "DATABASE_URL",
    "AUTH_DATABASE_URL",
    "SMTP_HOST",
    "SMTP_FROM",
    "MFA_ENCRYPTION_KEY",
    "MAIL_ENCRYPTION_KEY",
    "WEB_ORIGIN",
    "COOKIE_SECURE",
    "REQUIRE_VERIFIED_EMAIL",
  ])
    assert.throws(() => runtimePolicy({ ...operational, [key]: "" }), key);
  for (const unsafe of [
    { PUBLIC_REGISTRATION_ENABLED: "true" },
    { SMTP_ALLOW_INSECURE: "true" },
    { DEMO_PASSWORD: "synthetic-demo-only" },
    { WEB_ORIGIN: "https://user:secret@example.test" },
    { WEB_ORIGIN: "https://example.test/path" },
    { REAL_SENSITIVE_DOCUMENTS_ENABLED: "true" },
    { DEMO_DOCUMENTS_ENABLED: "true" },
  ])
    assert.throws(() => runtimePolicy({ ...operational, ...unsafe }));
});
test("administrative company bootstrap isolates owners, starts unverified, rejects duplicate accounts and enforces ten people", async () => {
  const db = await connect(undefined, true);
  try {
    await migrate(db);
    const first = await bootstrapCompany(db, {
      email: "OWNER@example.test",
      password: "Synthetic-bootstrap-only-2026",
      company: "Fictive company A",
    });
    const second = await bootstrapCompany(db, {
      email: "second@example.test",
      password: "Synthetic-bootstrap-only-2026",
      company: "Fictive company B",
    });
    assert.notEqual(first.tenant_id, second.tenant_id);
    const user = (
      await db.query(
        "SELECT email,email_verified_at,password_hash FROM users WHERE id=$1",
        [first.user_id],
      )
    ).rows[0];
    assert.equal(user.email, "owner@example.test");
    assert.equal(user.email_verified_at, null);
    assert.notEqual(user.password_hash, "Synthetic-bootstrap-only-2026");
    await assert.rejects(
      bootstrapCompany(db, {
        email: "owner@example.test",
        password: "Synthetic-bootstrap-only-2026",
        company: "Duplicate",
      }),
      /ACCOUNT_EXISTS/,
    );
    assert.equal(
      Number((await db.query("SELECT count(*) AS n FROM tenants")).rows[0].n),
      2,
    );
    for (let i = 2; i < 10; i++)
      await bootstrapCompany(db, {
        email: `owner-${i}@example.test`,
        password: "Synthetic-bootstrap-only-2026",
        company: `Fictive company ${i}`,
      });
    await assert.rejects(
      bootstrapCompany(db, {
        email: "eleventh@example.test",
        password: "Synthetic-bootstrap-only-2026",
        company: "Over capacity",
      }),
      /PILOT_USER_LIMIT/,
    );
    assert.equal(
      Number((await db.query("SELECT count(*) AS n FROM users")).rows[0].n),
      10,
    );
    assert.equal(
      Number((await db.query("SELECT count(*) AS n FROM tenants")).rows[0].n),
      10,
    );
  } finally {
    await db.close();
  }
});
