import {
  connect,
  migrate,
  asRole,
  assertRuntimePrivileges,
  type Database,
} from "./db";
import { createApp } from "./server";
async function main() {
  const demo = process.env.DEMO_MODE === "true";
  if (!demo) throw new Error("Prototype only: DEMO_MODE=true is required.");
  if (process.env.REAL_SENSITIVE_DOCUMENTS_ENABLED === "true")
    throw new Error("Sensitive documents cannot be enabled.");
  let db: Database, identity: Database;
  if (process.env.DATABASE_URL) {
    if (!process.env.AUTH_DATABASE_URL)
      throw new Error("AUTH_DATABASE_URL is required with PostgreSQL");
    db = await connect(process.env.DATABASE_URL, false, "taxilink_app");
    identity = await connect(
      process.env.AUTH_DATABASE_URL,
      false,
      "taxilink_identity",
    );
    await assertRuntimePrivileges(db, identity);
  } else {
    db = await connect();
    await migrate(db);
    identity = asRole(db, "taxilink_identity");
  }
  const app = await createApp(
    db,
    {
      demo,
      mfaKey: process.env.MFA_ENCRYPTION_KEY,
      webOrigin: process.env.WEB_ORIGIN,
      secureCookies: process.env.COOKIE_SECURE === "true",
    },
    identity,
  );
  await app.listen(Number(process.env.PORT || 4000), "0.0.0.0");
  const close = async () => {
    await app.close();
    await identity.close();
    await db.close();
  };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
  console.log("TAXI LINK API ready on port " + (process.env.PORT || 4000));
}
main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
