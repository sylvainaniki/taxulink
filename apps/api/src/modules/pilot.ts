import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db";
import type { Context } from "./operations";
import { requireThat } from "../security";
import { refreshRoutes, type RoutingProvider } from "../routing";
import * as schema from "../../../../packages/contracts/pilot";
import { assign } from "./operations";
import { optimization } from "./optimizer";
import type { PushTransport } from "../deliveries";
import type { AccountMail } from "../mail";
import { hash } from "../security";
import { encryptSecret, validMfaKey } from "../mfa";
export async function pilotOperations(
  q: Sql,
  c: Context,
  options: {
    routing?: RoutingProvider;
    push?: PushTransport;
    deliveryKey?: string;
    mail?: AccountMail;
  } = {},
) {
  const { path, method, tenant, user, role, body } = c,
    value = (value: any) => ({ value });
  const manage = () =>
    requireThat(["admin", "dispatcher"].includes(role), 403, "ACCESS_DENIED");
  const audit = (action: string, id: string) =>
    c.audit(q, tenant, user, action, id);
  const plan = await optimization(q, c);
  if (plan) return plan;
  if (method === "GET" && path === "/notification-settings")
    return value({
      push_available: Boolean(options.push && validMfaKey(options.deliveryKey)),
      email_available: Boolean(options.mail),
      email_enabled:
        (
          await q.query(
            "SELECT email_enabled FROM notification_preferences WHERE user_id=$1",
            [user],
          )
        ).rows[0]?.email_enabled || false,
      devices: (await q.query("SELECT list_push_devices() AS data")).rows[0]
        .data,
    });
  if (method === "POST" && path === "/notification-settings") {
    const d = z.object({ email_enabled: z.boolean() }).strict().parse(body);
    requireThat(!d.email_enabled || options.mail, 503, "MAIL_UNAVAILABLE");
    await q.query(
      "INSERT INTO notification_preferences(tenant_id,user_id,email_enabled) VALUES($1,$2,$3) ON CONFLICT(tenant_id,user_id) DO UPDATE SET email_enabled=EXCLUDED.email_enabled",
      [tenant, user, d.email_enabled],
    );
    await audit("notifications.preference_updated", user);
    return value({ ok: true });
  }
  if (method === "POST" && path === "/devices") {
    requireThat(
      options.push && validMfaKey(options.deliveryKey),
      503,
      "PUSH_NOT_CONFIGURED",
    );
    const d = z
      .object({
        token: z
          .string()
          .regex(
            /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/,
          ),
        platform: z.enum(["android", "ios"]),
      })
      .strict()
      .parse(body);
    const id = (
      await q.query("SELECT register_push_device($1,$2,$3,$4) AS id", [
        hash(d.token),
        encryptSecret(d.token, options.deliveryKey!),
        d.platform,
        c.sessionHash,
      ])
    ).rows[0].id;
    return value({ id });
  }
  if (method === "POST" && /^\/devices\/[a-f0-9-]+\/remove$/.test(path)) {
    const id = z.uuid().parse(path.split("/")[2]);
    await q.query("SELECT remove_push_device($1)", [id]);
    return value({ ok: true });
  }
  if (method === "GET" && path === "/settings") {
    manage();
    return value(
      (await q.query("SELECT * FROM company_settings")).rows[0] || {
        freeze_minutes: 60,
        ads_rules_enabled: false,
        regulatory_rules_confirmed: false,
        message_retention_days: 90,
        version: 0,
      },
    );
  }
  if (method === "POST" && path === "/settings") {
    requireThat(role === "admin", 403, "ACCESS_DENIED");
    const d = z
      .object({
        freeze_minutes: z.number().int().min(0).max(240),
        ads_rules_enabled: z.boolean(),
        regulatory_rules_confirmed: z.boolean(),
        message_retention_days: z.number().int().min(7).max(365),
        version: z.number().int().min(0),
      })
      .strict()
      .parse(body);
    requireThat(
      !d.ads_rules_enabled || d.regulatory_rules_confirmed,
      400,
      "REGULATORY_CONFIRMATION_REQUIRED",
    );
    await q.query(
      "INSERT INTO company_settings(tenant_id,version) VALUES($1,0) ON CONFLICT DO NOTHING",
      [tenant],
    );
    requireThat(
      (
        await q.query(
          "UPDATE company_settings SET freeze_minutes=$1,ads_rules_enabled=$2,regulatory_rules_confirmed=$3,message_retention_days=$4,version=version+1 WHERE tenant_id=$5 AND version=$6 RETURNING version",
          [
            d.freeze_minutes,
            d.ads_rules_enabled,
            d.regulatory_rules_confirmed,
            d.message_retention_days,
            tenant,
            d.version,
          ],
        )
      ).rows[0],
      409,
      "PLAN_STALE",
    );
    await audit("settings.updated", tenant);
    return value({ ok: true });
  }
  if (
    method === "POST" &&
    /^\/vehicles\/[a-f0-9-]+\/authorization$/.test(path)
  ) {
    manage();
    const d = z
        .object({
          ads_code: z.string().max(60),
          authorized_sectors: z.array(z.string().min(2).max(80)).max(50),
        })
        .strict()
        .parse(body),
      id = z.uuid().parse(path.split("/")[2]);
    requireThat(
      (
        await q.query(
          "UPDATE vehicles SET ads_code=$1,authorized_sectors=$2 WHERE id=$3 RETURNING id",
          [d.ads_code, JSON.stringify(d.authorized_sectors), id],
        )
      ).rows[0],
      404,
      "NOT_FOUND",
    );
    await audit("vehicle.authorization_updated", id);
    return value({ ok: true });
  }
  if (method === "GET" && path === "/absences") {
    requireThat(
      ["admin", "dispatcher", "driver"].includes(role),
      403,
      "ACCESS_DENIED",
    );
    return value(
      (
        await q.query(
          `SELECT r.* FROM resource_absences r LEFT JOIN drivers d ON d.id=r.driver_id WHERE r.active AND ($1 IN ('admin','dispatcher') OR d.user_id=$2) ORDER BY start_at LIMIT 200`,
          [role, user],
        )
      ).rows,
    );
  }
  if (method === "POST" && path === "/absences") {
    manage();
    const d = schema.absenceInput.parse(body),
      id = randomUUID();
    const resource = (
      await q.query(
        d.driver_id
          ? "SELECT id FROM drivers WHERE id=$1"
          : "SELECT id FROM vehicles WHERE id=$1",
        [d.driver_id || d.vehicle_id],
      )
    ).rows[0];
    requireThat(resource, 404, "NOT_FOUND");
    const affected = (
      await q.query(
        "SELECT a.course_id FROM assignments a JOIN courses c ON c.id=a.course_id WHERE (a.driver_id=$1 OR a.vehicle_id=$2) AND a.start_at<$4 AND a.end_at>$3 AND c.status NOT IN ('completed','cancelled','failed','no_show')",
        [d.driver_id || null, d.vehicle_id || null, d.start_at, d.end_at],
      )
    ).rows;
    requireThat(
      !affected.length || d.acknowledge_conflicts,
      409,
      "RESOURCE_COMMITTED",
    );
    await q.query(
      "INSERT INTO resource_absences(id,tenant_id,driver_id,vehicle_id,start_at,end_at,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        tenant,
        d.driver_id || null,
        d.vehicle_id || null,
        d.start_at,
        d.end_at,
        d.reason,
        user,
      ],
    );
    for (const item of affected) {
      await q.query(
        "INSERT INTO operational_alerts(id,tenant_id,course_id,kind,minutes) VALUES($1,$2,$3,'resource_unavailable',0)",
        [randomUUID(), tenant, item.course_id],
      );
      await q.query("SELECT notify_own_company('resource.unavailable',$1)", [
        item.course_id,
      ]);
    }
    await audit("resource.absence_created", id);
    return value({ id, affected: affected.map((v) => v.course_id) });
  }
  if (method === "POST" && /^\/absences\/[a-f0-9-]+\/cancel$/.test(path)) {
    manage();
    const id = z.uuid().parse(path.split("/")[2]);
    requireThat(
      (
        await q.query(
          "UPDATE resource_absences SET active=false WHERE id=$1 AND active RETURNING id",
          [id],
        )
      ).rows[0],
      404,
      "NOT_FOUND",
    );
    await audit("resource.absence_cancelled", id);
    return value({ ok: true });
  }
  if (method === "GET" && path === "/transfers") {
    requireThat(
      ["admin", "dispatcher", "driver"].includes(role),
      403,
      "ACCESS_DENIED",
    );
    return value(
      (
        await q.query(
          "SELECT r.*,c.reference FROM transfer_requests r JOIN courses c ON c.id=r.course_id WHERE ($1 IN ('admin','dispatcher') OR r.requested_by=$2) ORDER BY r.created_at DESC LIMIT 200",
          [role, user],
        )
      ).rows,
    );
  }
  if (
    method === "POST" &&
    /^\/courses\/[a-f0-9-]+\/transfer-request$/.test(path)
  ) {
    const id = z.uuid().parse(path.split("/")[2]),
      d = schema.transferInput.parse(body);
    const job = (
      await q.query(
        "SELECT c.*,d.user_id AS driver_user FROM courses c JOIN assignments a ON a.course_id=c.id JOIN drivers d ON d.id=a.driver_id WHERE c.id=$1",
        [id],
      )
    ).rows[0];
    requireThat(
      job &&
        (["admin", "dispatcher"].includes(role) ||
          (role === "driver" && job.driver_user === user)),
      404,
      "NOT_FOUND",
    );
    requireThat(
      ["assigned", "confirmed"].includes(job.status),
      409,
      "COURSE_FROZEN",
    );
    requireThat(job.version === d.version, 409, "PLAN_STALE");
    const request = randomUUID();
    await q.query(
      "INSERT INTO transfer_requests(id,tenant_id,course_id,requested_by,reason,course_version) VALUES($1,$2,$3,$4,$5,$6)",
      [request, tenant, id, user, d.reason, d.version],
    );
    await q.query("SELECT notify_own_company('course.transfer_requested',$1)", [
      id,
    ]);
    await audit("course.transfer_requested", id);
    return value({ id: request });
  }
  if (method === "POST" && /^\/transfers\/[a-f0-9-]+\/decision$/.test(path)) {
    manage();
    const id = z.uuid().parse(path.split("/")[2]),
      d = schema.transferDecisionInput.parse(body),
      request = (
        await q.query(
          "SELECT * FROM transfer_requests WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
    requireThat(request, 404, "NOT_FOUND");
    requireThat(request.status === "pending", 409, "PLAN_STALE");
    if (d.decision === "approve") {
      requireThat(d.driver_id && d.vehicle_id, 400, "RESOURCE_REQUIRED");
      const job = (
        await q.query("SELECT * FROM courses WHERE id=$1 FOR UPDATE", [
          request.course_id,
        ])
      ).rows[0];
      requireThat(job.version === request.course_version, 409, "PLAN_STALE");
      requireThat(
        ["assigned", "confirmed"].includes(job.status),
        409,
        "COURSE_FROZEN",
      );
      const old = (
        await q.query("SELECT * FROM assignments WHERE course_id=$1", [job.id])
      ).rows[0];
      requireThat(old, 409, "PLAN_STALE");
      requireThat(
        old.driver_id !== d.driver_id || old.vehicle_id !== d.vehicle_id,
        400,
        "TRANSFER_NO_CHANGE",
      );
      await q.query(
        "INSERT INTO assignment_history(id,tenant_id,course_id,details) VALUES($1,$2,$3,$4)",
        [
          randomUUID(),
          tenant,
          job.id,
          JSON.stringify({ ...old, transfer_request: id }),
        ],
      );
      await q.query("DELETE FROM assignments WHERE course_id=$1", [job.id]);
      await assign(q, tenant, job, d.driver_id!, d.vehicle_id!);
      await q.query(
        "INSERT INTO notifications(id,tenant_id,user_id,kind,object_id) SELECT gen_random_uuid(),$1,user_id,'course.reassigned',$2 FROM drivers WHERE id=$3 AND user_id IS NOT NULL",
        [tenant, job.id, old.driver_id],
      );
    }
    await q.query(
      "UPDATE transfer_requests SET status=$1,decided_at=now(),decided_by=$2 WHERE id=$3",
      [d.decision === "approve" ? "approved" : "rejected", user, id],
    );
    await audit("course.transfer_" + d.decision, request.course_id);
    return value({ ok: true });
  }
  if (method === "POST" && /^\/courses\/[a-f0-9-]+\/activate$/.test(path)) {
    manage();
    const d = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(body),
      id = z.uuid().parse(path.split("/")[2]);
    requireThat(
      (
        await q.query(
          "UPDATE courses SET status='unassigned',version=version+1 WHERE id=$1 AND version=$2 AND status='draft' RETURNING id",
          [id, d.version],
        )
      ).rows[0],
      409,
      "PLAN_STALE",
    );
    await audit("course.activated", id);
    return value({ ok: true });
  }
  if (method === "GET" && path === "/routing/status") {
    manage();
    return value({
      available: Boolean(options.routing),
      provider: options.routing?.name || null,
      traffic: "static",
      quota: 50,
      usage:
        (
          await q.query(
            "SELECT calls FROM routing_usage WHERE day=current_date",
          )
        ).rows[0]?.calls || 0,
    });
  }
  if (method === "GET" && path === "/routing/cache") {
    manage();
    return value(
      (
        await q.query(
          "SELECT origin,destination,minutes,distance_m,provider,calculated_at,expires_at FROM routes ORDER BY calculated_at DESC LIMIT 400",
        )
      ).rows,
    );
  }
  if (method === "POST" && path === "/locations") {
    manage();
    const d = schema.locationInput.parse(body),
      id = randomUUID();
    await q.query(
      "INSERT INTO locations(id,label,tenant_id,address,sector,latitude,longitude,validated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())",
      [id, d.label, tenant, d.address, d.sector, d.latitude, d.longitude],
    );
    await audit("location.created", id);
    return value({ id });
  }
  if (method === "POST" && path === "/routing/refresh") {
    manage();
    requireThat(options.routing, 503, "ROUTING_NOT_CONFIGURED");
    const d = schema.routingInput.parse(body);
    const result = await refreshRoutes(
      q,
      tenant,
      d.location_ids,
      options.routing!,
    );
    await audit("routing.refreshed", randomUUID());
    return value(result);
  }
  // Prepare cross-company travel without returning the offer’s private coordinates.
  if (
    method === "POST" &&
    /^\/offers\/[a-f0-9-]+\/claim$/.test(path) &&
    options.routing
  ) {
    const course = (
      await q.query("SELECT offer_claim_context($1) AS data", [
        path.split("/")[2],
      ])
    ).rows[0].data;
    const d = z
      .object({ driver_id: z.uuid(), vehicle_id: z.uuid() })
      .strict()
      .parse(body);
    const driver = (
      await q.query("SELECT * FROM drivers WHERE id=$1", [d.driver_id])
    ).rows[0];
    const vehicle = (
      await q.query("SELECT * FROM vehicles WHERE id=$1", [d.vehicle_id])
    ).rows[0];
    requireThat(
      driver &&
        vehicle &&
        (["admin", "dispatcher"].includes(role) || driver.user_id === user),
      403,
      "ACCESS_DENIED",
    );
    const ids = [
      ...new Set([
        course.origin,
        course.destination,
        driver.start_location,
        driver.end_location,
        vehicle.start_location,
      ]),
    ];
    const existing = (
      await q.query(
        "SELECT count(*)::int AS n FROM routes WHERE origin=ANY($1::text[]) AND destination=ANY($1::text[]) AND expires_at>now()",
        [ids],
      )
    ).rows[0].n;
    if (existing < ids.length * ids.length)
      await refreshRoutes(q, tenant, ids, options.routing!);
  }
}
