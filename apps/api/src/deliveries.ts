import type { Database } from "./db";
import type { AccountMail } from "./mail";
import { decryptSecret } from "./mfa";
export interface PushTransport {
  send(
    token: string,
    notification: string,
    tenant: string,
  ): Promise<{ ticket?: string; unregistered?: boolean }>;
  receipt(ticket: string): Promise<"ok" | "retry" | "unregistered" | "failed">;
}
async function expo(path: string, body: any) {
  const response = await fetch(`https://exp.host/--/api/v2/push/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("PUSH_UNAVAILABLE");
  return response.json();
}
export function pushFromEnv(): PushTransport | undefined {
  if (process.env.PUSH_ENABLED !== "true") return;
  return {
    send: async (token, notification, tenant) => {
      const result = await expo("send", {
          to: token,
          title: "TAXILINK",
          body: "Un événement demande votre attention. Ouvrez votre espace.",
          sound: "default",
          data: { notification_id: notification, tenant_id: tenant },
        }),
        ticket = result.data;
      if (ticket?.status === "ok" && ticket.id) return { ticket: ticket.id };
      if (ticket?.details?.error === "DeviceNotRegistered")
        return { unregistered: true };
      throw new Error("PUSH_REJECTED");
    },
    receipt: async (ticket) => {
      const result = await expo("getReceipts", { ids: [ticket] }),
        receipt = result.data?.[ticket];
      if (!receipt) return "retry";
      if (receipt.status === "ok") return "ok";
      return receipt.details?.error === "DeviceNotRegistered"
        ? "unregistered"
        : "failed";
    },
  };
}
export async function deliverNotification(
  db: Database,
  options: { mail?: AccountMail; push?: PushTransport; key?: string },
) {
  return db.transaction(async (q) => {
    const job = (
      await q.query(
        "SELECT * FROM notification_deliveries WHERE status IN ('pending','receipt') AND attempts<5 AND next_attempt<=now() AND created_at>now()-interval '24 hours' AND (($1 AND channel='email') OR ($2 AND channel='push')) ORDER BY next_attempt LIMIT 1 FOR UPDATE SKIP LOCKED",
        [Boolean(options.mail), Boolean(options.push)],
      )
    ).rows[0];
    if (!job) return false;
    const context = (
      await q.query("SELECT delivery_context($1) AS data", [job.id])
    ).rows[0].data;
    if (!context) {
      await q.query(
        "UPDATE notification_deliveries SET status='failed' WHERE id=$1",
        [job.id],
      );
      return true;
    }
    try {
      let status = "sent",
        ticket = job.ticket_id;
      if (job.channel === "email")
        await options.mail!.send({
          to: context.email,
          subject: "TAXILINK — Nouvel événement",
          text: `Un événement demande votre attention. Connectez-vous à votre espace : ${options.mail!.origin}/\n\nAucune information passager n’est incluse dans ce message.`,
        });
      else if (job.status === "receipt") {
        const result = await options.push!.receipt(job.ticket_id);
        if (result === "retry") throw new Error("RECEIPT_PENDING");
        if (result === "unregistered")
          await q.query("DELETE FROM push_devices WHERE id=$1", [
            job.device_id,
          ]);
        if (result === "failed" || result === "unregistered") status = "failed";
      } else {
        const result = await options.push!.send(
          decryptSecret(context.encrypted_token, options.key!),
          context.notification_id,
          context.tenant_id,
        );
        if (result.unregistered) {
          await q.query("DELETE FROM push_devices WHERE id=$1", [
            job.device_id,
          ]);
          status = "failed";
        } else {
          if (!result.ticket) throw new Error("PUSH_INVALID_TICKET");
          status = "receipt";
          ticket = result.ticket;
        }
      }
      await q.query(
        "UPDATE notification_deliveries SET status=$1,ticket_id=$2,next_attempt=now()+interval '15 minutes' WHERE id=$3",
        [status, ticket, job.id],
      );
    } catch {
      await q.query(
        "UPDATE notification_deliveries SET attempts=attempts+1,next_attempt=now()+interval '1 minute'*power(2,attempts),status=CASE WHEN attempts>=4 THEN 'failed' ELSE status END WHERE id=$1",
        [job.id],
      );
      console.warn("Notification delivery deferred.");
    }
    return true;
  });
}
