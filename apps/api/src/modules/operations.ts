import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql, Row } from "../db";
import { requireThat, Fault, hash } from "../security";
import { validateAssignment } from "../planning";
import { recurring } from "./recurrence";
import * as types from "../../../../packages/contracts";
export interface Context {
  path: string;
  method: string;
  body: any;
  query: Record<string, any>;
  tenant: string;
  user: string;
  role: string;
  audit: (q: Sql, t: string, u: string, a: string, id: string) => Promise<void>;
}
const objectId = (path: string) => types.uuid.parse(path.split("/")[2]);
import { contactInput } from "../../../../packages/contracts/extended";
const read = (q: Sql, sql: string, params?: any[]) =>
  q.query(sql, params).then((r) => r.rows);
async function snapshot(q: Sql) {
  const data = [];
  for (const table of [
    "courses",
    "drivers",
    "vehicles",
    "assignments",
    "driver_shifts",
    "resource_holds",
  ])
    data.push(await read(q, `SELECT * FROM ${table} ORDER BY id`));
  data.push(await read(q, "SELECT * FROM routes ORDER BY origin,destination"));
  data.push(
    await read(
      q,
      "SELECT user_id,role,active FROM memberships ORDER BY user_id",
    ),
  );
  return hash(JSON.stringify(data));
}
async function resources(q: Sql) {
  return {
    drivers: await read(q, "SELECT * FROM drivers WHERE active ORDER BY id"),
    vehicles: await read(q, "SELECT * FROM vehicles WHERE active ORDER BY id"),
  };
}
async function assign(
  q: Sql,
  tenant: string,
  c: Row,
  did: string,
  vid: string,
) {
  const d = (await read(q, "SELECT * FROM drivers WHERE id=$1", [did]))[0],
    v = (await read(q, "SELECT * FROM vehicles WHERE id=$1", [vid]))[0];
  requireThat(d && v, 404, "NOT_FOUND");
  requireThat(
    !(await read(q, "SELECT course_has_live_offer($1) AS live", [c.id]))[0]
      .live,
    409,
    "COURSE_OFFERED",
  );
  const timing = await validateAssignment(q, c, d, v);
  await q.query("INSERT INTO assignments VALUES($1,$2,$3,$4,$5,$6,$7)", [
    randomUUID(),
    tenant,
    c.id,
    did,
    vid,
    timing.start,
    timing.end,
  ]);
  await q.query(
    "UPDATE courses SET status='assigned',version=version+1 WHERE id=$1",
    [c.id],
  );
  if (d.user_id)
    await q.query(
      "INSERT INTO notifications(id,tenant_id,user_id,kind,object_id) VALUES($1,$2,$3,'course.assigned',$4)",
      [randomUUID(), tenant, d.user_id, c.id],
    );
  return timing;
}
export async function operations(
  q: Sql,
  c: Context,
): Promise<{ value: any } | undefined> {
  const other = await recurring(q, c);
  if (other) return other;
  const { path, method, tenant, user, role, body } = c;
  const value = (value: any) => ({ value });
  const manage = () =>
    requireThat(["admin", "dispatcher"].includes(role), 403, "ACCESS_DENIED");
  const admin = () => requireThat(role === "admin", 403, "ACCESS_DENIED");
  const audit = (action: string, id: string) =>
    c.audit(q, tenant, user, action, id);
  if (method === "GET") {
    if (path === "/conversations")
      return value(
        (await read(q, "SELECT list_conversations() AS data"))[0].data,
      );
    if (path === "/people")
      return value((await read(q, "SELECT company_people() AS data"))[0].data);
    if (/^\/conversations\/[a-f0-9-]+\/messages$/.test(path))
      return value(
        (
          await read(q, "SELECT read_private_messages($1) AS data", [
            objectId(path),
          ])
        )[0].data,
      );
    if (path === "/company")
      return value(
        (await read(q, "SELECT id,name,timezone,network_code FROM tenants"))[0],
      );
    if (path === "/alerts") {
      manage();
      return value(
        await read(
          q,
          "SELECT * FROM operational_alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 100",
        ),
      );
    }
    if (path === "/members") {
      admin();
      return value((await read(q, "SELECT company_members() AS data"))[0].data);
    }
    if (path === "/offers")
      return value(
        (await read(q, "SELECT list_network_offers() AS data"))[0].data,
      );
    if (path === "/network-invitations") {
      admin();
      return value(
        (await read(q, "SELECT list_network_invitations() AS data"))[0].data,
      );
    }
    if (/^\/groups\/[a-f0-9-]+\/members$/.test(path))
      return value(
        (
          await read(q, "SELECT list_network_members($1) AS data", [
            objectId(path),
          ])
        )[0].data,
      );
    if (/^\/groups\/[a-f0-9-]+\/messages$/.test(path)) {
      const after = c.query.after
        ? types.timestamp.parse(c.query.after)
        : "1970-01-01T00:00:00Z";
      return value(
        (
          await read(q, "SELECT network_messages($1,$2) AS data", [
            objectId(path),
            after,
          ])
        )[0].data,
      );
    }
    if (path === "/notifications")
      return value(
        await read(
          q,
          "SELECT id,kind,object_id,created_at,read_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [user],
        ),
      );
    if (path === "/contacts") {
      manage();
      return value(
        await read(q, "SELECT * FROM contacts ORDER BY name LIMIT 500"),
      );
    }
    if (path === "/recurrences") {
      manage();
      return value(
        await read(
          q,
          "SELECT * FROM recurrences ORDER BY start_date DESC LIMIT 100",
        ),
      );
    }
    if (path === "/shifts") {
      manage();
      return value(
        await read(
          q,
          "SELECT * FROM driver_shifts ORDER BY shift_start LIMIT 500",
        ),
      );
    }
    if (path === "/analytics") {
      manage();
      return value(
        (
          await read(
            q,
            `SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='completed')::int AS completed,COUNT(*) FILTER(WHERE status='unassigned')::int AS unassigned,COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled,COUNT(*) FILTER(WHERE source_course_id IS NOT NULL)::int AS received FROM courses`,
          )
        )[0],
      );
    }
    if (path === "/exports/courses") {
      manage();
      await audit("courses.exported", tenant);
      return value({
        columns: ["reference", "pickup_at", "origin", "destination", "status"],
        rows: (
          await read(
            q,
            "SELECT reference,pickup_at,origin,destination,status FROM courses ORDER BY pickup_at LIMIT 10000",
          )
        ).map((r) =>
          Object.values(r).map((v) => {
            const s = v instanceof Date ? v.toISOString() : String(v);
            return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
          }),
        ),
      });
    }
    if (path === "/plans") {
      manage();
      return value(
        await read(
          q,
          "SELECT id,created_at,expires_at,proposal,status FROM planning_proposals ORDER BY created_at DESC LIMIT 20",
        ),
      );
    }
    if (path === "/vehicles" && role === "driver")
      return value(
        await read(
          q,
          "SELECT id,label,seats,accessible FROM vehicles WHERE active ORDER BY label",
        ),
      );
  }
  if (method !== "POST") return;
  if (path === "/conversations") {
    const d = z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("course"), course_id: types.uuid }).strict(),
        z.object({ kind: z.literal("direct"), user_id: types.uuid }).strict(),
      ])
      .parse(body);
    return value({
      id: (
        await read(q, "SELECT start_conversation($1,$2,$3) AS id", [
          d.kind,
          d.kind === "course" ? d.course_id : null,
          d.kind === "direct" ? d.user_id : null,
        ])
      )[0].id,
    });
  }
  if (/^\/conversations\/[a-f0-9-]+\/messages$/.test(path)) {
    const d = z
      .object({ body: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(body);
    return value({
      id: (
        await read(q, "SELECT send_private_message($1,$2) AS id", [
          objectId(path),
          d.body,
        ])
      )[0].id,
    });
  }
  if (/^\/offers\/[a-f0-9-]+\/claim$/.test(path)) {
    const d = z
        .object({ driver_id: types.uuid, vehicle_id: types.uuid })
        .strict()
        .parse(body),
      id = objectId(path);
    const course = (
      await read(q, "SELECT offer_claim_context($1) AS data", [id])
    )[0].data;
    const driver = (
        await read(q, "SELECT * FROM drivers WHERE id=$1", [d.driver_id])
      )[0],
      vehicle = (
        await read(q, "SELECT * FROM vehicles WHERE id=$1", [d.vehicle_id])
      )[0];
    requireThat(driver && vehicle, 404, "NOT_FOUND");
    requireThat(
      ["admin", "dispatcher"].includes(role) ||
        (role === "driver" && driver.user_id === user),
      403,
      "ACCESS_DENIED",
    );
    const timing = await validateAssignment(q, course, driver, vehicle);
    return value(
      (
        await read(q, "SELECT reserve_offer($1,$2,$3,$4,$5) AS data", [
          id,
          d.driver_id,
          d.vehicle_id,
          timing.start,
          timing.end,
        ])
      )[0].data,
    );
  }
  if (/^\/groups\/[a-f0-9-]+\/invite-code$/.test(path)) {
    admin();
    const d = z
      .object({ code: z.string().regex(/^[a-zA-Z0-9]{12}$/) })
      .strict()
      .parse(body);
    return value({
      id: (
        await read(q, "SELECT invite_network_code($1,$2) AS id", [
          objectId(path),
          d.code,
        ])
      )[0].id,
    });
  }
  if (/^\/courses\/[a-f0-9-]+\/delay$/.test(path)) {
    const id = objectId(path),
      d = z
        .object({ minutes: z.number().int().min(1).max(240) })
        .strict()
        .parse(body);
    const job = (
      await read(
        q,
        "SELECT c.id,a.driver_id,dr.user_id FROM courses c LEFT JOIN assignments a ON a.course_id=c.id LEFT JOIN drivers dr ON dr.id=a.driver_id WHERE c.id=$1 AND c.status IN ('assigned','approaching','onboard')",
        [id],
      )
    )[0];
    requireThat(job, 404, "NOT_FOUND");
    requireThat(
      ["admin", "dispatcher"].includes(role) ||
        (role === "driver" && job.user_id === user),
      403,
      "ACCESS_DENIED",
    );
    const alert = randomUUID();
    await q.query(
      "INSERT INTO operational_alerts(id,tenant_id,course_id,kind,minutes) VALUES($1,$2,$3,'delay',$4)",
      [alert, tenant, id, d.minutes],
    );
    await q.query("SELECT bridge_mission_delay($1,$2)", [id, d.minutes]);
    await audit("course.delay_reported", id);
    return value({ id: alert, status: "reported", planning_changed: false });
  }
  if (/^\/alerts\/[a-f0-9-]+\/resolve$/.test(path)) {
    manage();
    requireThat(
      (
        await read(
          q,
          "UPDATE operational_alerts SET resolved_at=now() WHERE id=$1 RETURNING id",
          [objectId(path)],
        )
      ).length,
      404,
      "NOT_FOUND",
    );
    await audit("alert.resolved", objectId(path));
    return value({ ok: true });
  }
  if (path === "/offers") {
    manage();
    const d = z
      .object({
        course_id: types.uuid,
        group_id: types.uuid.optional(),
        group_ids: z.array(types.uuid).min(1).max(8).optional(),
        expires_at: types.timestamp,
      })
      .strict()
      .refine((v) => Boolean(v.group_id) !== Boolean(v.group_ids))
      .parse(body);
    const groups = [...new Set(d.group_ids || [d.group_id!])];
    const id = (
      await read(q, "SELECT publish_offer($1,$2,$3) AS id", [
        d.course_id,
        groups[0],
        d.expires_at,
      ])
    )[0].id;
    for (const group of groups.slice(1))
      await q.query("SELECT add_offer_target($1,$2)", [id, group]);
    return value({ id });
  }
  if (/^\/offers\/[a-f0-9-]+\/decision$/.test(path)) {
    manage();
    const d = z
      .object({ decision: z.enum(["approve", "reject", "withdraw"]) })
      .strict()
      .parse(body);
    return value(
      (
        await read(q, "SELECT decide_offer($1,$2) AS data", [
          objectId(path),
          d.decision,
        ])
      )[0].data,
    );
  }
  if (/^\/groups\/[a-f0-9-]+\/invite$/.test(path)) {
    admin();
    const d = z.object({ tenant_id: types.uuid }).strict().parse(body);
    return value({
      id: (
        await read(q, "SELECT network_invitation($1,$2) AS id", [
          objectId(path),
          d.tenant_id,
        ])
      )[0].id,
    });
  }
  if (/^\/network-invitations\/[a-f0-9-]+\/accept$/.test(path)) {
    admin();
    await q.query("SELECT accept_network_invitation($1)", [objectId(path)]);
    return value({ ok: true });
  }
  if (/^\/groups\/[a-f0-9-]+\/remove-member$/.test(path)) {
    admin();
    const d = z.object({ tenant_id: types.uuid }).strict().parse(body);
    await q.query("SELECT remove_network_member($1,$2)", [
      objectId(path),
      d.tenant_id,
    ]);
    return value({ ok: true });
  }
  if (/^\/groups\/[a-f0-9-]+\/messages$/.test(path)) {
    const d = z
      .object({ body: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(body);
    return value({
      id: (
        await read(q, "SELECT send_network_message($1,$2) AS id", [
          objectId(path),
          d.body,
        ])
      )[0].id,
    });
  }
  if (/^\/notifications\/[a-f0-9-]+\/read$/.test(path)) {
    await q.query(
      "UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2",
      [objectId(path), user],
    );
    return value({ ok: true });
  }
  if (/^\/members\/[a-f0-9-]+\/update$/.test(path)) {
    admin();
    const id = objectId(path);
    requireThat(id !== user, 409, "SELF_CHANGE_FORBIDDEN");
    const d = z
      .object({ role: z.enum(types.roles), active: z.boolean() })
      .strict()
      .parse(body);
    const old = (
      await read(q, "SELECT role FROM memberships WHERE user_id=$1", [id])
    )[0];
    requireThat(old, 404, "NOT_FOUND");
    if (old.role === "admin" && (d.role !== "admin" || !d.active))
      requireThat(
        Number(
          (
            await read(
              q,
              "SELECT COUNT(*) AS count FROM memberships WHERE role='admin' AND active",
            )
          )[0].count,
        ) > 1,
        409,
        "LAST_ADMIN",
      );
    await q.query("UPDATE memberships SET role=$1,active=$2 WHERE user_id=$3", [
      d.role,
      d.active,
      id,
    ]);
    await q.query("DELETE FROM idempotency WHERE actor_id=$1", [id]);
    await audit("membership.updated", id);
    return value({ ok: true });
  }
  if (/^\/(drivers|vehicles)\/[a-f0-9-]+\/update$/.test(path)) {
    manage();
    const kind = path.split("/")[1],
      id = objectId(path);
    requireThat(
      !(
        await read(
          q,
          `SELECT 1 FROM assignments a JOIN courses c ON c.id=a.course_id WHERE a.${kind === "drivers" ? "driver_id" : "vehicle_id"}=$1 AND c.status NOT IN ('completed','cancelled') UNION ALL SELECT 1 FROM resource_holds WHERE ${kind === "drivers" ? "driver_id" : "vehicle_id"}=$1 AND expires_at>now()`,
          [id],
        )
      ).length,
      409,
      "RESOURCE_COMMITTED",
    );
    const data =
      kind === "drivers"
        ? types.driverInput.parse(body)
        : z
            .object({
              label: z.string().min(1).max(60),
              seats: z.number().int().min(1).max(8),
              accessible: z.boolean(),
              active: z.boolean(),
            })
            .strict()
            .parse(body);
    if (kind === "drivers") {
      const v = data as z.infer<typeof types.driverInput>;
      requireThat(
        (
          await read(
            q,
            "UPDATE drivers SET name=$1,shift_start=$2,shift_end=$3,start_location=$4,end_location=$5,breaks=$6,user_id=$7 WHERE id=$8 RETURNING id",
            [
              v.name,
              v.shift_start,
              v.shift_end,
              v.start_location,
              v.end_location,
              JSON.stringify(v.breaks),
              v.user_id || null,
              id,
            ],
          )
        ).length,
        404,
        "NOT_FOUND",
      );
    } else {
      const v = data as Row;
      requireThat(
        (
          await read(
            q,
            "UPDATE vehicles SET label=$1,seats=$2,accessible=$3,active=$4 WHERE id=$5 RETURNING id",
            [v.label, v.seats, v.accessible, v.active, id],
          )
        ).length,
        404,
        "NOT_FOUND",
      );
    }
    await audit(kind + ".updated", id);
    return value({ ok: true });
  }
  if (path === "/shifts") {
    manage();
    const d = z
      .object({ driver_id: types.uuid, shift: types.driverInput })
      .strict()
      .parse(body);
    requireThat(
      (await read(q, "SELECT id FROM drivers WHERE id=$1", [d.driver_id]))[0],
      404,
      "NOT_FOUND",
    );
    requireThat(
      !(
        await read(
          q,
          "SELECT 1 FROM driver_shifts WHERE driver_id=$1 AND shift_start<$3 AND shift_end>$2",
          [d.driver_id, d.shift.shift_start, d.shift.shift_end],
        )
      ).length,
      409,
      "SHIFT_OVERLAP",
    );
    requireThat(
      !(
        await read(
          q,
          "SELECT 1 FROM drivers WHERE id=$1 AND shift_start<$3 AND shift_end>$2",
          [d.driver_id, d.shift.shift_start, d.shift.shift_end],
        )
      ).length,
      409,
      "SHIFT_OVERLAP",
    );
    const id = randomUUID();
    await q.query("INSERT INTO driver_shifts VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [
      id,
      tenant,
      d.driver_id,
      d.shift.shift_start,
      d.shift.shift_end,
      d.shift.start_location,
      d.shift.end_location,
      JSON.stringify(d.shift.breaks),
    ]);
    await audit("shift.created", id);
    return value({ id });
  }
  if (/^\/courses\/[a-f0-9-]+\/unassign$/.test(path)) {
    manage();
    const id = objectId(path),
      d = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(body);
    const course = (
      await read(q, "SELECT * FROM courses WHERE id=$1", [id])
    )[0];
    requireThat(course, 404, "NOT_FOUND");
    requireThat(course.version === d.version, 409, "PLAN_STALE");
    requireThat(
      course.status === "assigned" &&
        !course.source_course_id &&
        !(await read(q, "SELECT shared_source($1) AS shared", [id]))[0].shared,
      409,
      "COURSE_FROZEN",
    );
    const old = (
      await read(q, "SELECT * FROM assignments WHERE course_id=$1", [id])
    )[0];
    await q.query(
      "INSERT INTO assignment_history(id,tenant_id,course_id,details) VALUES($1,$2,$3,$4)",
      [randomUUID(), tenant, id, JSON.stringify(old)],
    );
    await q.query("DELETE FROM assignments WHERE course_id=$1", [id]);
    await q.query(
      "UPDATE courses SET status='unassigned',version=version+1 WHERE id=$1",
      [id],
    );
    await audit("course.unassigned", id);
    return value({ ok: true });
  }
  if (/^\/courses\/[a-f0-9-]+\/status$/.test(path)) {
    const id = objectId(path);
    if ((await read(q, "SELECT shared_source($1) AS shared", [id]))[0].shared) {
      manage();
      const d = types.statusInput.parse(body);
      requireThat(d.status === "cancelled", 409, "EXECUTOR_CONTROLS_STATUS");
      await q.query("SELECT cancel_shared_course($1,$2)", [id, d.version]);
      return value({ id, status: "cancelled", version: d.version + 1 });
    }
  }
  if (/^\/courses\/[a-f0-9-]+\/update$/.test(path)) {
    manage();
    const id = objectId(path),
      d = z
        .object({
          course: types.courseInput,
          version: z.number().int().positive(),
        })
        .strict()
        .parse(body);
    const old = (await read(q, "SELECT * FROM courses WHERE id=$1", [id]))[0];
    requireThat(old, 404, "NOT_FOUND");
    requireThat(old.version === d.version, 409, "PLAN_STALE");
    requireThat(
      old.status === "unassigned" &&
        !old.source_course_id &&
        !(await read(q, "SELECT course_has_live_offer($1) AS live", [id]))[0]
          .live,
      409,
      "COURSE_FROZEN",
    );
    const v = d.course;
    const customer = v.customer_id
      ? (
          await read(
            q,
            "SELECT name,phone FROM contacts WHERE id=$1 AND kind='customer'",
            [v.customer_id],
          )
        )[0]
      : null;
    requireThat(!v.customer_id || customer, 404, "NOT_FOUND");
    await q.query(
      "UPDATE courses SET reference=$1,origin=$2,destination=$3,pickup_at=$4,appointment_at=$5,arrival_buffer=$6,passengers=$7,accessible=$8,customer_id=$9,passenger_name=$10,passenger_phone=$11,version=version+1 WHERE id=$12",
      [
        v.reference,
        v.origin,
        v.destination,
        v.pickup_at,
        v.appointment_at,
        v.arrival_buffer,
        v.passengers,
        v.accessible,
        v.customer_id || null,
        customer?.name || "",
        customer?.phone || "",
        id,
      ],
    );
    await audit("course.updated", id);
    return value({ id, version: d.version + 1 });
  }
  if (path === "/contacts") {
    manage();
    const d = contactInput.parse(body),
      id = randomUUID();
    await q.query(
      "INSERT INTO contacts(id,tenant_id,name,kind,phone,address) VALUES($1,$2,$3,$4,$5,$6)",
      [id, tenant, d.name, d.kind, d.phone, d.address],
    );
    await audit("contact.created", id);
    return value({ id });
  }
  if (/^\/contacts\/[a-f0-9-]+\/update$/.test(path)) {
    manage();
    const d = z
        .object({ contact: contactInput, version: z.number().int().positive() })
        .strict()
        .parse(body),
      id = objectId(path),
      v = d.contact;
    requireThat(
      (
        await read(
          q,
          "UPDATE contacts SET name=$1,kind=$2,phone=$3,address=$4,version=version+1 WHERE id=$5 AND version=$6 RETURNING id",
          [v.name, v.kind, v.phone, v.address, id, d.version],
        )
      ).length,
      409,
      "PLAN_STALE",
    );
    await audit("contact.updated", id);
    return value({ id });
  }
  if (path === "/plans/propose") {
    manage();
    const d = z.object({ date: z.iso.date() }).strict().parse(body),
      inputSnapshot = await snapshot(q),
      id = randomUUID(),
      { drivers, vehicles } = await resources(q);
    const jobs = await read(
      q,
      "SELECT * FROM courses WHERE status='unassigned' AND NOT course_has_live_offer(id) AND (pickup_at AT TIME ZONE 'Europe/Paris')::date=$1::date ORDER BY appointment_at,id",
      [d.date],
    );
    const assigned: any[] = [],
      unassigned: any[] = [];
    requireThat(jobs.length <= 500, 422, "PLANNING_BATCH_TOO_LARGE");
    const load = new Map<string, number>(),
      affinity = new Map<string, Set<string>>();
    const started = Date.now();
    const commitments = await read(
      q,
      "SELECT a.driver_id,a.vehicle_id,a.start_at,a.end_at FROM assignments a JOIN courses c ON c.id=a.course_id WHERE c.status<>'cancelled' AND (a.start_at AT TIME ZONE 'Europe/Paris')::date=$1::date UNION ALL SELECT driver_id,vehicle_id,start_at,end_at FROM resource_holds WHERE expires_at>now() AND (start_at AT TIME ZONE 'Europe/Paris')::date=$1::date",
      [d.date],
    );
    for (const item of commitments) {
      load.set(
        item.driver_id,
        (load.get(item.driver_id) || 0) +
          (new Date(item.end_at).getTime() -
            new Date(item.start_at).getTime()) /
            60000,
      );
      const used = affinity.get(item.vehicle_id) || new Set<string>();
      used.add(item.driver_id);
      affinity.set(item.vehicle_id, used);
    }
    await q.query("SAVEPOINT simulation");
    const shiftRows = await read(
      q,
      "SELECT * FROM driver_shifts ORDER BY shift_start",
    );
    for (const job of jobs) {
      if (Date.now() - started > 30000) {
        unassigned.push({ course_id: job.id, reasons: ["CALCULATION_BUDGET"] });
        continue;
      }
      let success = false;
      const reasons = new Set<string>();
      for (const driver of [...drivers].sort(
        (a, b) =>
          (load.get(a.id) || 0) - (load.get(b.id) || 0) ||
          a.id.localeCompare(b.id),
      )) {
        if (success) break;
        const startTime = new Date(job.pickup_at).getTime();
        const shift =
          shiftRows.find(
            (s) =>
              s.driver_id === driver.id &&
              new Date(s.shift_start).getTime() <= startTime &&
              new Date(s.shift_end).getTime() > startTime,
          ) || driver;
        if (
          startTime < new Date(shift.shift_start).getTime() ||
          startTime >= new Date(shift.shift_end).getTime()
        ) {
          reasons.add("SHIFT_CONFLICT");
          continue;
        }
        const rank = (v: Row) =>
          affinity.get(v.id)?.has(driver.id) ? 0 : affinity.has(v.id) ? 2 : 1;
        for (const vehicle of [...vehicles].sort(
          (a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id),
        )) {
          if (
            vehicle.seats < job.passengers ||
            (job.accessible && !vehicle.accessible)
          ) {
            reasons.add("VEHICLE_INCOMPATIBLE");
            continue;
          }
          try {
            await q.query("SAVEPOINT candidate");
            const timing = await assign(q, tenant, job, driver.id, vehicle.id);
            load.set(
              driver.id,
              (load.get(driver.id) || 0) +
                (Date.parse(timing.end) - Date.parse(timing.start)) / 60000,
            );
            const used = affinity.get(vehicle.id) || new Set<string>();
            used.add(driver.id);
            affinity.set(vehicle.id, used);
            await q.query("RELEASE SAVEPOINT candidate");
            assigned.push({
              course_id: job.id,
              driver_id: driver.id,
              vehicle_id: vehicle.id,
            });
            success = true;
            break;
          } catch (e) {
            await q.query("ROLLBACK TO SAVEPOINT candidate");
            await q.query("RELEASE SAVEPOINT candidate");
            if (e instanceof Fault) reasons.add(e.code);
            else throw e;
          }
        }
      }
      if (!success)
        unassigned.push({
          course_id: job.id,
          reasons: reasons.size ? [...reasons] : ["NO_DRIVER"],
        });
    }
    await q.query("ROLLBACK TO SAVEPOINT simulation");
    await q.query("RELEASE SAVEPOINT simulation");
    const proposal = { assigned, unassigned, algorithm: "balanced-greedy-v2" };
    await q.query(
      "INSERT INTO planning_proposals VALUES($1,$2,$3,now(),now()+interval '10 minutes',$4,$5,'proposed')",
      [id, tenant, user, inputSnapshot, JSON.stringify(proposal)],
    );
    await audit("plan.proposed", id);
    return value({ id, ...proposal });
  }
  if (/^\/plans\/[a-f0-9-]+\/apply$/.test(path)) {
    manage();
    const id = objectId(path),
      plan = (
        await read(
          q,
          "SELECT * FROM planning_proposals WHERE id=$1 FOR UPDATE",
          [id],
        )
      )[0];
    requireThat(plan, 404, "NOT_FOUND");
    requireThat(
      plan.status === "proposed" &&
        new Date(plan.expires_at).getTime() > Date.now() &&
        plan.snapshot === (await snapshot(q)),
      409,
      "PLAN_STALE",
    );
    for (const item of plan.proposal.assigned) {
      const job = (
        await read(q, "SELECT * FROM courses WHERE id=$1", [item.course_id])
      )[0];
      requireThat(job?.status === "unassigned", 409, "PLAN_STALE");
      await assign(q, tenant, job, item.driver_id, item.vehicle_id);
      await audit("course.assigned", job.id);
    }
    await q.query(
      "UPDATE planning_proposals SET status='applied' WHERE id=$1",
      [id],
    );
    await audit("plan.applied", id);
    return value({
      id,
      status: "applied",
      count: plan.proposal.assigned.length,
    });
  }
}
