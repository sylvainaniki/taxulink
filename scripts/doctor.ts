import { runtimePolicy } from "../apps/api/src/runtime-policy";
import { validMfaKey } from "../apps/api/src/mfa";

type Env = Record<string, string | undefined>;
export type Check = { id: string; ok: boolean; message: string };

// Never include supplied values or raw exception messages in diagnostics.
export function configurationChecks(env: Env): Check[] {
  const checks: Check[] = [];
  const add = (id: string, ok: boolean, message: string) =>
    checks.push({ id, ok, message });
  let policy = false;
  try {
    runtimePolicy(env);
    policy = true;
  } catch {}
  add("runtime", policy, "Politique de démarrage valide");
  add(
    "documents",
    env.REAL_SENSITIVE_DOCUMENTS_ENABLED !== "true" &&
      env.DEMO_DOCUMENTS_ENABLED !== "true",
    "BT et photos gérés hors TAXILINK",
  );
  add(
    "invitations",
    env.PUBLIC_REGISTRATION_ENABLED !== "true",
    "Accès sur invitation uniquement",
  );
  for (const key of ["MFA_ENCRYPTION_KEY", "MAIL_ENCRYPTION_KEY"])
    add(key, validMfaKey(env[key]), `${key} : clé de 32 octets hexadécimale`);
  add(
    "distinct-keys",
    Boolean(env.MFA_ENCRYPTION_KEY && env.MAIL_ENCRYPTION_KEY) &&
      env.MFA_ENCRYPTION_KEY?.toLowerCase() !==
        env.MAIL_ENCRYPTION_KEY?.toLowerCase(),
    "Clés MFA et email distinctes",
  );
  const network = Boolean(env.DATABASE_URL || env.AUTH_DATABASE_URL);
  if (network || env.DEMO_MODE !== "true") {
    const urls = [env.DATABASE_URL, env.AUTH_DATABASE_URL];
    const parsed = urls.map((value) => {
      try {
        const url = new URL(value || "");
        return ["postgres:", "postgresql:"].includes(url.protocol) &&
          url.hostname &&
          url.pathname.length > 1 &&
          url.username
          ? url
          : undefined;
      } catch {
        return undefined;
      }
    });
    add(
      "database-urls",
      parsed.every(Boolean),
      "Deux connexions PostgreSQL renseignées",
    );
    add(
      "database-identities",
      Boolean(parsed[0] && parsed[1]) &&
        parsed[0]?.username !== parsed[1]?.username,
      "Identités PostgreSQL métier et authentification distinctes",
    );
  }
  if (env.SMTP_HOST || env.DEMO_MODE !== "true") {
    add("mail-host", Boolean(env.SMTP_HOST?.trim()), "Serveur SMTP renseigné");
    add(
      "mail-from",
      /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.SMTP_FROM || ""),
      "Adresse expéditrice SMTP valide",
    );
    const port = Number(env.SMTP_PORT || 587);
    add(
      "mail-port",
      Number.isInteger(port) && port > 0 && port <= 65535,
      "Port SMTP valide",
    );
    add(
      "mail-auth",
      !env.SMTP_USER || Boolean(env.SMTP_PASSWORD),
      "Mot de passe SMTP présent lorsque requis",
    );
  }
  return checks;
}

export async function main(
  args = process.argv.slice(2),
  env: Env = process.env,
) {
  if (args.some((arg) => arg !== "--json")) {
    console.error("Usage : npm run doctor -- [--json]");
    process.exitCode = 2;
    return;
  }
  const checks = configurationChecks(env);
  const result = {
    mode: env.DEMO_MODE === "true" ? "demonstration" : "pilote",
    ok: checks.every((check) => check.ok),
    checks,
    scope:
      "Configuration uniquement ; aucune connexion, migration ou émission d’email. Ne valide ni l’hébergement, ni les sauvegardes, ni une mise en exploitation réelle.",
  };
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`TAXILINK — diagnostic ${result.mode}`);
    for (const check of checks)
      console.log(`${check.ok ? "OK" : "À CORRIGER"} : ${check.message}`);
    console.log(result.scope);
  }
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("/doctor.ts")) void main();
