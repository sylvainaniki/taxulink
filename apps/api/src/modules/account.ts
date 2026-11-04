import type { Request, Response } from "express";
import type { Database, Sql, Row } from "../db";
import type { AccountMail } from "../mail";
import { enqueueAccountLink } from "../mail";
import { consumeFactor } from "../mfa";
import { hash, passwordHash, requireThat } from "../security";
import {
  accountEmailInput,
  accountTokenInput,
  resetPasswordInput,
} from "../../../../packages/contracts/account";

export async function accountRoutes(
  req: Request,
  res: Response,
  path: string,
  db: Database,
  options: { mail?: AccountMail; mfaKey?: string },
  session: (q: Sql, req: Request) => Promise<Row>,
) {
  if (
    req.method !== "POST" ||
    ![
      "/auth/password/request",
      "/auth/password/reset",
      "/auth/email/request",
      "/auth/email/verify",
    ].includes(path)
  )
    return false;
  requireThat(options.mail, 503, "MAIL_UNAVAILABLE");
  const mail = options.mail!;
  if (path === "/auth/password/request") {
    const d = accountEmailInput.parse(req.body);
    await db.transaction(async (q) => {
      await q.query("SELECT id FROM collaboration_lock WHERE id=1 FOR UPDATE");
      const user = (
        await q.query("SELECT id,email FROM users WHERE email=$1", [
          d.email.toLowerCase(),
        ])
      ).rows[0];
      if (user)
        await enqueueAccountLink(
          q,
          mail,
          user as { id: string; email: string },
          "reset",
        );
    });
    // Identical response for unknown, throttled and existing accounts.
    res.json({ ok: true });
    return true;
  }
  await db.transaction(async (q) => {
    await q.query("SELECT id FROM collaboration_lock WHERE id=1 FOR UPDATE");
    if (path === "/auth/email/request") {
      const s = await session(q, req);
      requireThat(req.headers["x-csrf-token"] === s.csrf, 403, "CSRF_DENIED");
      const user = (
        await q.query(
          "SELECT id,email,email_verified_at FROM users WHERE id=$1",
          [s.user_id],
        )
      ).rows[0];
      if (!user.email_verified_at)
        await enqueueAccountLink(
          q,
          mail,
          user as { id: string; email: string },
          "verify",
        );
      return;
    }
    const reset =
      path === "/auth/password/reset"
        ? resetPasswordInput.parse(req.body)
        : null;
    const d = reset || accountTokenInput.parse(req.body);
    const purpose = path === "/auth/password/reset" ? "reset" : "verify";
    const link = (
      await q.query(
        "SELECT * FROM account_links WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() FOR UPDATE",
        [hash(d.token), purpose],
      )
    ).rows[0];
    requireThat(link, 400, "ACCOUNT_LINK_INVALID");
    if (reset) {
      const user = (
        await q.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
          link.user_id,
        ])
      ).rows[0];
      if (user.mfa_secret)
        await consumeFactor(
          q,
          user,
          reset.mfa_code,
          reset.recovery_code,
          options.mfaKey,
        );
      await q.query(
        "UPDATE users SET password_hash=$1,mfa_pending=NULL,mfa_pending_until=NULL WHERE id=$2",
        [passwordHash(reset.password), link.user_id],
      );
      await q.query("DELETE FROM sessions WHERE user_id=$1", [link.user_id]);
      // Invalidate both verification and reset links after password recovery.
      await q.query("DELETE FROM account_links WHERE user_id=$1", [
        link.user_id,
      ]);
    } else {
      await q.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
        link.user_id,
      ]);
      await q.query("DELETE FROM account_links WHERE token_hash=$1", [
        hash(d.token),
      ]);
    }
    await q.query(
      "INSERT INTO audit_events(id,tenant_id,actor_id,action,object_id) SELECT gen_random_uuid(),tenant_id,$1,$2,$1 FROM memberships WHERE user_id=$1 AND active",
      [
        link.user_id,
        purpose === "reset"
          ? "account.password_recovered"
          : "account.email_verified",
      ],
    );
  });
  res.json({ ok: true });
  return true;
}
