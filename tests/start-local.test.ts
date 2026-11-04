import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  localConfiguration,
  assertLocalPortFree,
} from "../scripts/start-local";

const local = {
  DEMO_MODE: "true",
  DEMO_PASSWORD: "Synthetic-local-test-2026",
  WEB_ORIGIN: "http://localhost:3000",
  MFA_ENCRYPTION_KEY: "a".repeat(64),
  MAIL_ENCRYPTION_KEY: "b".repeat(64),
};
test("local launcher binds services to loopback and preserves the no-documents scope", () => {
  const env = localConfiguration(local);
  assert.equal(env.API_HOST, "127.0.0.1");
  assert.equal(env.API_ORIGIN, "http://127.0.0.1:4000");
  assert.equal(env.REAL_SENSITIVE_DOCUMENTS_ENABLED, "false");
  assert.equal(env.DEMO_DOCUMENTS_ENABLED, "false");
  assert.equal(env.PUBLIC_REGISTRATION_ENABLED, "false");
});
test("local launcher rejects hosted settings, missing secrets and incompatible cookie origins", () => {
  for (const patch of [
    { DEMO_MODE: "false" },
    { DATABASE_URL: "postgresql://synthetic.invalid/db" },
    { AUTH_DATABASE_URL: "postgresql://synthetic.invalid/db" },
    { MIGRATION_DATABASE_URL: "postgresql://synthetic.invalid/db" },
    { WEB_ORIGIN: "https://example.test" },
    { COOKIE_SECURE: "true" },
    { DEMO_PASSWORD: "short" },
    { MFA_ENCRYPTION_KEY: "" },
    { PUBLIC_REGISTRATION_ENABLED: "true" },
  ])
    assert.throws(() => localConfiguration({ ...local, ...patch }));
});
test("local launcher refuses occupied ports and releases its successful port probe", async () => {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  try {
    await assert.rejects(assertLocalPortFree(port), /indisponible/);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
  await assertLocalPortFree(port);
  await assertLocalPortFree(port);
});
