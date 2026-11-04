import { validMfaKey } from "./mfa";

// Configuration checks are technical safeguards, never a compliance attestation.
export function runtimePolicy(env: Record<string, string | undefined>) {
  const demo = env.DEMO_MODE === "true";
  if (
    env.REAL_SENSITIVE_DOCUMENTS_ENABLED === "true" ||
    env.DEMO_DOCUMENTS_ENABLED === "true"
  )
    throw new Error("Document uploads are outside the hosted pilot scope");
  if (demo) return { demo: true };
  if (env.OPERATIONAL_PILOT_ENABLED !== "true")
    throw new Error("Operational pilot is not enabled");
  for (const key of [
    "DATABASE_URL",
    "AUTH_DATABASE_URL",
    "SMTP_HOST",
    "SMTP_FROM",
  ])
    if (!env[key]) throw new Error(`Operational pilot requires ${key}`);
  for (const key of ["MFA_ENCRYPTION_KEY", "MAIL_ENCRYPTION_KEY"])
    if (!validMfaKey(env[key]))
      throw new Error(`Operational pilot requires a valid ${key}`);
  const origin = new URL(env.WEB_ORIGIN || "http://localhost");
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("Operational pilot requires a canonical HTTPS WEB_ORIGIN");
  if (
    env.COOKIE_SECURE !== "true" ||
    env.REQUIRE_VERIFIED_EMAIL !== "true" ||
    env.SMTP_ALLOW_INSECURE === "true" ||
    env.PUBLIC_REGISTRATION_ENABLED === "true"
  )
    throw new Error(
      "Operational pilot requires secure cookies, verified email, TLS mail and invitation-only access",
    );
  if (env.DEMO_PASSWORD)
    throw new Error(
      "Remove demo credentials before starting the operational pilot",
    );
  return { demo: false };
}
