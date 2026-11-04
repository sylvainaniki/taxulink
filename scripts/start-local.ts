import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { configurationChecks } from "./doctor";

export function localConfiguration(env: Record<string, string | undefined>) {
  if (
    env.DEMO_MODE !== "true" ||
    env.DATABASE_URL ||
    env.AUTH_DATABASE_URL ||
    env.MIGRATION_DATABASE_URL
  )
    throw new Error(
      "Le démarrage local exige une démonstration PGlite sans connexion PostgreSQL.",
    );
  if (
    env.WEB_ORIGIN !== "http://localhost:3000" ||
    env.COOKIE_SECURE === "true"
  )
    throw new Error(
      "Le démarrage local exige WEB_ORIGIN=http://localhost:3000 et COOKIE_SECURE=false.",
    );
  if (!env.DEMO_PASSWORD || env.DEMO_PASSWORD.length < 16)
    throw new Error(
      "Exécuter npm run setup pour créer la configuration locale.",
    );
  if (!configurationChecks(env).every((check) => check.ok))
    throw new Error("Configuration incomplète : exécuter npm run doctor.");
  return {
    ...env,
    PORT: "4000",
    API_HOST: "127.0.0.1",
    API_ORIGIN: "http://127.0.0.1:4000",
    COOKIE_SECURE: "false",
    PUBLIC_REGISTRATION_ENABLED: "false",
    REAL_SENSITIVE_DOCUMENTS_ENABLED: "false",
    DEMO_DOCUMENTS_ENABLED: "false",
  };
}

export async function assertLocalPortFree(port: number) {
  await new Promise<void>((done, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} indisponible ; fermer l’autre service avant de relancer TAXILINK.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : done())),
    );
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--dev"))
    throw new Error("Usage : npm start ou npm run dev:local");
  const env = localConfiguration(process.env);
  const dev = args.includes("--dev");
  if (!dev) {
    try {
      await access(resolve("apps/web/.next/BUILD_ID"));
    } catch {
      throw new Error(
        "Compiler d’abord l’application avec npm run build, ou utiliser npm run dev:local.",
      );
    }
  }
  await assertLocalPortFree(3000);
  await assertLocalPortFree(4000);
  const children = new Set<ChildProcess>();
  let stopping = false;
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill("SIGTERM");
    setTimeout(() => {
      for (const child of children) child.kill("SIGKILL");
    }, 5000).unref();
  };
  process.once("SIGINT", () => stop(0));
  process.once("SIGTERM", () => stop(0));
  const launch = (args: string[], cwd = process.cwd(), oneShot = false) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: "inherit" });
    children.add(child);
    child.on("error", () => stop(1));
    child.on("exit", (code) => {
      children.delete(child);
      if (!stopping && (!oneShot || code !== 0)) stop(1);
    });
    return child;
  };
  // Seed closes PGlite before the API opens it; existing fixtures are preserved.
  const seed = launch(
    ["--import", "tsx", "apps/api/src/seed.ts"],
    undefined,
    true,
  );
  await new Promise<void>((done) => {
    seed.once("exit", () => done());
    seed.once("error", () => done());
  });
  if (stopping) return;
  launch(["--import", "tsx", "apps/api/src/main.ts"]);
  let ready = false;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:4000/api/v1/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).demo === true) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  if (stopping) return;
  if (!ready) {
    console.error("L’API locale ne répond pas ; arrêt des services.");
    stop(1);
    return;
  }
  launch(
    [
      resolve("node_modules/next/dist/bin/next"),
      dev ? "dev" : "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ],
    resolve("apps/web"),
  );
  console.log(
    "TAXILINK : http://localhost:3000 — démonstration locale. Ctrl+C arrête les deux services.",
  );
}

if (process.argv[1]?.endsWith("/start-local.ts"))
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
