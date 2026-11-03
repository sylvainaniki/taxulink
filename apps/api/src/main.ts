import { connect, migrate } from "./db";
import { createApp } from "./server";
async function main() {
  const demo = process.env.DEMO_MODE === "true";
  if (!demo)
    throw new Error(
      "Prototype only: set DEMO_MODE=true. Production is not enabled.",
    );
  if (process.env.REAL_SENSITIVE_DOCUMENTS_ENABLED === "true")
    throw new Error("Sensitive documents cannot be enabled in this version.");
  const db = await connect(process.env.DATABASE_URL);
  await migrate(db);
  const app = await createApp(db, {
    demo,
    webOrigin: process.env.WEB_ORIGIN,
    secureCookies: process.env.COOKIE_SECURE === "true",
  });
  await app.listen(Number(process.env.PORT || 4000), "0.0.0.0");
  const close = async () => {
    await app.close();
    await db.close();
  };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());
  console.log("TAXI LINK API: http://localhost:" + (process.env.PORT || 4000));
}
main().catch(() => {
  console.error(
    "Startup failed. Check DEMO_MODE, database and migration configuration.",
  );
  process.exitCode = 1;
});
