import { spawn } from "node:child_process";
import { resolve } from "node:path";

for (const key of [
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "WEB_ORIGIN",
  "MFA_ENCRYPTION_KEY",
]) {
  if (!process.env[key])
    throw new Error(`Missing hosted configuration: ${key}`);
}
if (!process.env.WEB_ORIGIN.startsWith("https://"))
  throw new Error("Hosted origin must use HTTPS");
if (
  process.env.DEMO_MODE !== "true" &&
  process.env.OPERATIONAL_PILOT_ENABLED !== "true"
)
  throw new Error(
    "An explicitly enabled operational pilot or synthetic demonstration is required",
  );
const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 4000)
  throw new Error("Invalid public port");
const env = {
  ...process.env,
  COOKIE_SECURE: "true",
  REAL_SENSITIVE_DOCUMENTS_ENABLED: "false",
};
// Migration access belongs to a separate one-off provisioning step.
delete env.SCALINGO_POSTGRESQL_URL;
delete env.BOOTSTRAP_ADMIN_EMAIL;
delete env.BOOTSTRAP_ADMIN_PASSWORD;
delete env.BOOTSTRAP_COMPANY;
delete env.MIGRATION_DATABASE_URL;
delete env.API_DB_PASSWORD;
delete env.AUTH_DB_PASSWORD;
const children = new Set();
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 8000).unref();
}
function launch(args, childEnv, cwd) {
  const child = spawn(process.execPath, args, {
    env: childEnv,
    cwd,
    stdio: "inherit",
  });
  children.add(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) stop(code || 1);
  });
  return child;
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
launch(
  ["--import", "tsx", "apps/api/src/main.ts"],
  { ...env, PORT: "4000", API_HOST: "127.0.0.1" },
  process.cwd(),
);
let ready = false;
for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
  try {
    const r = await fetch("http://127.0.0.1:4000/api/v1/health", {
      signal: AbortSignal.timeout(1000),
    });
    if (r.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!ready) {
  console.error("Hosted API did not become ready");
  stop(1);
} else
  launch(
    [
      resolve("node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "0.0.0.0",
      "--port",
      String(port),
    ],
    env,
    resolve("apps/web"),
  );
