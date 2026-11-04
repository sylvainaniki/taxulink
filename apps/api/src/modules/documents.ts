import { z } from "zod";
import { documentUploadInput } from "../../../../packages/contracts/documents";
import type { Sql } from "../db";
import type { Context } from "./operations";
import { sanitizeDocument, type DocumentService } from "../documents";
import { encryptSecret, decryptSecret } from "../mfa";
import { hash, requireThat } from "../security";
export async function documentOperations(
  q: Sql,
  c: Context,
  service: DocumentService,
) {
  const { path, method, body, tenant, user, role } = c;
  if (!path.startsWith("/documents")) return;
  const value = (value: any) => ({ value });
  const manage = () =>
    requireThat(["admin", "dispatcher"].includes(role), 403, "ACCESS_DENIED");
  const id = path.split("/")[2] ? z.uuid().parse(path.split("/")[2]) : null;
  if (method === "GET" && path === "/documents")
    return value(
      (await q.query("SELECT list_private_documents() AS data")).rows[0].data,
    );
  if (method === "POST" && path === "/documents") {
    manage();
    const d = documentUploadInput.parse(body);
    const original = Buffer.from(d.content, "base64");
    requireThat(
      original.toString("base64") === d.content,
      400,
      "DOCUMENT_INVALID",
    );
    // Scan the original first, so re-encoding cannot erase a malicious test signature.
    let scan: "clean" | "infected" | "unavailable" = "unavailable";
    try {
      scan = await service.scan(original);
    } catch {}
    requireThat(scan !== "infected", 400, "DOCUMENT_INFECTED");
    const content = await sanitizeDocument(original, d.mime);
    try {
      scan = await service.scan(content);
    } catch {
      scan = "unavailable";
    }
    requireThat(scan !== "infected", 400, "DOCUMENT_INFECTED");
    const metadata = {
      ...d,
      content: undefined,
      encrypted_payload: encryptSecret(content.toString("base64"), service.key),
      digest: hash(content.toString("base64")),
      bytes: content.length,
      scan_status: scan,
      status: scan === "clean" ? "received" : "quarantined",
    };
    const did = (
      await q.query("SELECT save_private_document($1) AS id", [
        JSON.stringify(metadata),
      ])
    ).rows[0].id;
    return value({ id: did, status: metadata.status, scan_status: scan });
  }
  if (method === "GET" && path.endsWith("/grants"))
    return value(
      (await q.query("SELECT private_document_grants($1) AS data", [id]))
        .rows[0].data,
    );
  if (method === "GET" && path.endsWith("/content")) {
    const document = (
      await q.query("SELECT read_private_document($1,false) AS data", [id])
    ).rows[0].data;
    requireThat(
      ["received", "verified"].includes(document.status) &&
        document.scan_status === "clean",
      403,
      "DOCUMENT_QUARANTINED",
    );
    requireThat(
      !document.expires_at || Date.parse(document.expires_at) > Date.now(),
      403,
      "DOCUMENT_EXPIRED",
    );
    await c.audit(q, tenant, user, "document.accessed", id!);
    return value({
      mime: document.mime,
      content: decryptSecret(document.encrypted_payload, service.key),
      title: "document-fictif",
    });
  }
  if (method === "POST" && path.endsWith("/review")) {
    manage();
    const d = z
      .object({
        version: z.number().int().positive(),
        status: z.enum(["verified", "rejected", "expired", "deleted"]),
        legal_hold: z.boolean().optional(),
      })
      .strict()
      .parse(body);
    await q.query("SELECT review_private_document($1,$2,$3,NULL,$4)", [
      id,
      d.version,
      d.status,
      d.legal_hold ?? null,
    ]);
    return value({ ok: true });
  }
  if (method === "POST" && path.endsWith("/rescan")) {
    manage();
    const document = (
      await q.query("SELECT read_private_document($1,true) AS data", [id])
    ).rows[0].data;
    requireThat(document.status !== "deleted", 409, "INVALID_TRANSITION");
    let scan: "clean" | "infected" | "unavailable" = "unavailable";
    try {
      scan = await service.scan(
        Buffer.from(
          decryptSecret(document.encrypted_payload, service.key),
          "base64",
        ),
      );
    } catch {}
    await q.query("SELECT review_private_document($1,$2,$3,$4,NULL)", [
      id,
      document.version,
      scan === "clean"
        ? "received"
        : scan === "infected"
          ? "rejected"
          : "quarantined",
      scan,
    ]);
    return value({ scan_status: scan });
  }
  if (method === "POST" && path.endsWith("/grant")) {
    const d = z
      .object({
        target_user_id: z.uuid(),
        target_tenant_id: z.uuid(),
        expires_at: z.iso.datetime({ offset: true }),
      })
      .strict()
      .parse(body);
    return value({
      id: (
        await q.query("SELECT grant_private_document($1,$2,$3,$4) AS id", [
          id,
          d.target_user_id,
          d.target_tenant_id,
          d.expires_at,
        ])
      ).rows[0].id,
    });
  }
  if (method === "POST" && path.endsWith("/revoke-grant")) {
    const d = z.object({ grant_id: z.uuid() }).strict().parse(body);
    await q.query("SELECT revoke_private_document($1)", [d.grant_id]);
    return value({ ok: true });
  }
}
