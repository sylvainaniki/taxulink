import { runtimePolicy } from "./runtime-policy";
import {
  connect,
  migrate,
  asRole,
  assertRuntimePrivileges,
  type Database,
} from "./db";
import { createApp } from "./server";
import { ignRouting } from "./ign-routing";
import { ignGeocoder } from "./geocoding";
import { routingFromEnv } from "./routing";
import { deliverNotification, pushFromEnv } from "./deliveries";
import { validMfaKey } from "./mfa";
import { accountMailFromEnv, deliverAccountMail } from "./mail";
async function main() {
  const { demo } = runtimePolicy(process.env);
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
  const mail = accountMailFromEnv();
  const push = pushFromEnv();
  if (push && !validMfaKey(process.env.MAIL_ENCRYPTION_KEY))
    throw new Error("PUSH_REQUIRES_MAIL_ENCRYPTION_KEY");
  const requireVerifiedEmail = process.env.REQUIRE_VERIFIED_EMAIL === "true";
  if (requireVerifiedEmail && !mail)
    throw new Error("Verified email policy requires configured account mail");
  const app = await createApp(
    db,
    {
      demo,
      publicRegistration: process.env.PUBLIC_REGISTRATION_ENABLED === "true",
      maxActiveUsers: 10,
      mfaKey: process.env.MFA_ENCRYPTION_KEY,
      webOrigin: process.env.WEB_ORIGIN,
      secureCookies: process.env.COOKIE_SECURE === "true",
      mail,
      routing:
        process.env.ROUTING_ENABLED === "false"
          ? undefined
          : routingFromEnv() || ignRouting(),
      geocoding:
        process.env.GEOCODING_ENABLED === "false" ? undefined : ignGeocoder(),
      push,
      deliveryKey: process.env.MAIL_ENCRYPTION_KEY,
      requireVerifiedEmail,
    },
    identity,
  );
  await app.listen(
    Number(process.env.PORT || 4000),
    process.env.API_HOST || "0.0.0.0",
  );
  let delivering = false;
  const mailTimer =
    mail || push
      ? setInterval(async () => {
          if (delivering) return;
          delivering = true;
          try {
            if (mail) await deliverAccountMail(identity, mail);
            await deliverNotification(identity, {
              mail,
              push,
              key: process.env.MAIL_ENCRYPTION_KEY,
            });
          } catch {
            console.warn("Account email queue unavailable.");
          } finally {
            delivering = false;
          }
        }, 2000)
      : undefined;
  mailTimer?.unref();
  const close = async () => {
    if (mailTimer) clearInterval(mailTimer);
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
