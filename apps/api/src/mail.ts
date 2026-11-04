import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import type { Database, Sql } from "./db";
import { decryptSecret, encryptSecret, validMfaKey } from "./mfa";
import { hash, token } from "./security";

export type MailMessage = { to: string; subject: string; text: string };
export interface AccountMail {
  key: string;
  origin: string;
  send(message: MailMessage): Promise<void>;
}
export function accountMailFromEnv(): AccountMail | undefined {
  if (!process.env.SMTP_HOST) return;
  const key = process.env.MAIL_ENCRYPTION_KEY || "";
  if (!validMfaKey(key))
    throw new Error("MAIL_ENCRYPTION_KEY must contain 64 hex characters");
  const origin = new URL(process.env.WEB_ORIGIN || "http://localhost:3000");
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("WEB_ORIGIN must be an origin without credentials or path");
  const insecure = process.env.SMTP_ALLOW_INSECURE === "true";
  if (
    insecure &&
    !(
      process.env.DEMO_MODE === "true" &&
      ["localhost", "127.0.0.1", "mailpit"].includes(process.env.SMTP_HOST)
    )
  )
    throw new Error(
      "Plaintext SMTP is limited to the local demonstration mailbox",
    );
  if (
    origin.protocol !== "https:" &&
    !(
      process.env.DEMO_MODE === "true" &&
      ["localhost", "127.0.0.1"].includes(origin.hostname)
    )
  )
    throw new Error(
      "Account links require HTTPS outside the local demonstration",
    );
  const from = process.env.SMTP_FROM || "";
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from))
    throw new Error("SMTP_FROM must be a mailbox address");
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP_PORT is invalid");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: !insecure,
    ignoreTLS: insecure,
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD || "",
          },
        }
      : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    key,
    origin: origin.origin,
    send: async (message) => {
      await transport.sendMail({ from, ...message });
    },
  };
}

export async function enqueueAccountLink(
  q: Sql,
  mail: AccountMail,
  user: { id: string; email: string },
  purpose: "reset" | "verify",
) {
  const existing = (
    await q.query(
      "SELECT created_at>now()-interval '1 minute' AS recent FROM account_links WHERE user_id=$1 AND purpose=$2",
      [user.id, purpose],
    )
  ).rows[0];
  if (existing?.recent) return;
  // Replacing a link also removes its queued delivery through the foreign key.
  await q.query("DELETE FROM account_links WHERE user_id=$1 AND purpose=$2", [
    user.id,
    purpose,
  ]);
  const raw = token(),
    digest = hash(raw);
  await q.query(
    "INSERT INTO account_links(token_hash,user_id,purpose,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
    [digest, user.id, purpose],
  );
  const link = `${mail.origin}/#${purpose}=${raw}`;
  const message: MailMessage = {
    to: user.email,
    subject:
      purpose === "reset"
        ? "TAXILINK — Réinitialiser votre mot de passe"
        : "TAXILINK — Vérifier votre adresse email",
    text: `${purpose === "reset" ? "Réinitialisez votre mot de passe" : "Confirmez votre adresse email"} en ouvrant ce lien, valable 30 minutes et utilisable une seule fois :\n\n${link}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez ce message. Ne transmettez pas ce lien.`,
  };
  await q.query(
    "INSERT INTO account_mail(id,token_hash,encrypted_payload,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
    [randomUUID(), digest, encryptSecret(JSON.stringify(message), mail.key)],
  );
}

export async function deliverAccountMail(db: Database, mail: AccountMail) {
  return db.transaction(async (q) => {
    await q.query("DELETE FROM account_links WHERE expires_at<=now()");
    // Network delivery only holds a queue row, never the global business lock.
    const job = (
      await q.query(
        "SELECT * FROM account_mail WHERE sent_at IS NULL AND next_attempt<=now() AND expires_at>now() AND attempts<5 ORDER BY next_attempt LIMIT 1 FOR UPDATE SKIP LOCKED",
      )
    ).rows[0];
    if (!job) return false;
    try {
      await mail.send(
        JSON.parse(decryptSecret(job.encrypted_payload, mail.key)),
      );
      await q.query(
        "UPDATE account_mail SET sent_at=now(),encrypted_payload='' WHERE id=$1",
        [job.id],
      );
    } catch {
      await q.query(
        "UPDATE account_mail SET attempts=attempts+1,next_attempt=now()+interval '1 minute'*power(2,attempts) WHERE id=$1",
        [job.id],
      );
      // No recipient, reset token, SMTP response or message content in logs.
      console.warn("Account email delivery deferred.");
    }
    return true;
  });
}
