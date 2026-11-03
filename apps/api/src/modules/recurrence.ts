import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db";
import type { Context } from "./operations";
import { requireThat, Fault } from "../security";
import * as types from "../../../../packages/contracts";
import { parisDateTime } from "../../../../packages/contracts/dates";
import { recurrenceInput as rule } from "../../../../packages/contracts/extended";
export async function insertCourse(
  q: Sql,
  tenant: string,
  data: unknown,
  extra?: { recurrence?: string; returnOf?: string },
) {
  const d = types.courseInput.parse(data),
    id = randomUUID();
  const customer = d.customer_id
    ? (
        await q.query(
          "SELECT name,phone FROM contacts WHERE id=$1 AND kind='customer'",
          [d.customer_id],
        )
      ).rows[0]
    : null;
  requireThat(!d.customer_id || customer, 404, "NOT_FOUND");
  const rows = (
    await q.query(
      "INSERT INTO courses(id,tenant_id,reference,origin,destination,pickup_at,appointment_at,arrival_buffer,passengers,accessible,recurrence_key,return_of,customer_id,passenger_name,passenger_phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING RETURNING id",
      [
        id,
        tenant,
        d.reference,
        d.origin,
        d.destination,
        d.pickup_at,
        d.appointment_at,
        d.arrival_buffer,
        d.passengers,
        d.accessible,
        extra?.recurrence || null,
        extra?.returnOf || null,
        d.customer_id || null,
        customer?.name || "",
        customer?.phone || "",
      ],
    )
  ).rows;
  return rows[0]?.id;
}
export async function recurring(
  q: Sql,
  c: Context,
): Promise<{ value: any } | undefined> {
  const { path, method, body, tenant, user, role } = c;
  const manage = () =>
    requireThat(["admin", "dispatcher"].includes(role), 403, "ACCESS_DENIED");
  if (method === "GET" && path === "/pending-returns") {
    manage();
    return {
      value: (
        await q.query(
          "SELECT id,reference,origin,destination,pickup_at,version FROM courses WHERE return_pending ORDER BY pickup_at",
        )
      ).rows,
    };
  }
  if (method !== "POST") return;
  if (path === "/recurrences") {
    manage();
    const d = rule.parse(body),
      id = randomUUID();
    await q.query(
      "INSERT INTO recurrences(id,tenant_id,template,start_date,end_date,weekdays,exceptions,interval_weeks) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        tenant,
        JSON.stringify(d.template),
        d.start_date,
        d.end_date,
        JSON.stringify([...new Set(d.weekdays)]),
        JSON.stringify(d.exceptions),
        d.interval_weeks,
      ],
    );
    await c.audit(q, tenant, user, "recurrence.created", id);
    return { value: { id } };
  }
  if (/^\/recurrences\/[a-f0-9-]+\/generate$/.test(path)) {
    manage();
    const id = types.uuid.parse(path.split("/")[2]),
      r = (
        await q.query("SELECT * FROM recurrences WHERE id=$1 AND active", [id])
      ).rows[0];
    requireThat(r, 404, "NOT_FOUND");
    let generated = 0;
    const start = Date.parse(
        (r.start_date instanceof Date
          ? r.start_date.toISOString()
          : String(r.start_date)
        ).slice(0, 10) + "T00:00:00Z",
      ),
      end = Date.parse(
        (r.end_date instanceof Date
          ? r.end_date.toISOString()
          : String(r.end_date)
        ).slice(0, 10) + "T00:00:00Z",
      );
    const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * 86400000;
    for (let ms = start; ms <= end; ms += 86400000) {
      const day = new Date(ms).toISOString().slice(0, 10),
        weekday = ((new Date(ms).getUTCDay() + 6) % 7) + 1;
      if (
        !r.weekdays.includes(weekday) ||
        r.exceptions.includes(day) ||
        Math.floor((ms - monday) / (7 * 86400000)) % r.interval_weeks !== 0
      )
        continue;
      const t = r.template;
      let pickup: string, appointment: string;
      try {
        pickup = parisDateTime(day, t.pickup_time);
        appointment = parisDateTime(day, t.appointment_time);
      } catch {
        throw new Fault(422, "LOCAL_TIME_INVALID");
      }
      if (
        await insertCourse(
          q,
          tenant,
          {
            reference: t.reference,
            ...(t.customer_id ? { customer_id: t.customer_id } : {}),
            origin: t.origin,
            destination: t.destination,
            pickup_at: pickup,
            appointment_at: appointment,
            arrival_buffer: t.arrival_buffer,
            passengers: t.passengers,
            accessible: t.accessible,
          },
          { recurrence: id + "/" + day },
        )
      )
        generated++;
    }
    await c.audit(q, tenant, user, "recurrence.generated", id);
    return { value: { id, generated } };
  }
  if (/^\/recurrences\/[a-f0-9-]+\/stop$/.test(path)) {
    manage();
    const id = types.uuid.parse(path.split("/")[2]);
    requireThat(
      (
        await q.query(
          "UPDATE recurrences SET active=false WHERE id=$1 RETURNING id",
          [id],
        )
      ).rows[0],
      404,
      "NOT_FOUND",
    );
    await c.audit(q, tenant, user, "recurrence.stopped", id);
    return { value: { ok: true } };
  }
  if (/^\/courses\/[a-f0-9-]+\/return$/.test(path)) {
    manage();
    const id = types.uuid.parse(path.split("/")[2]),
      d = z
        .object({
          version: z.number().int().positive(),
          pickup_at: types.timestamp.optional(),
          appointment_at: types.timestamp.optional(),
        })
        .strict()
        .parse(body);
    const course = (
      await q.query(
        "SELECT * FROM courses WHERE id=$1 AND source_course_id IS NULL",
        [id],
      )
    ).rows[0];
    requireThat(course, 404, "NOT_FOUND");
    requireThat(course.version === d.version, 409, "PLAN_STALE");
    requireThat(course.status !== "cancelled", 409, "COURSE_FROZEN");
    if (!d.pickup_at) {
      requireThat(!d.appointment_at, 400, "VALIDATION_ERROR");
      await q.query(
        "UPDATE courses SET return_pending=true,version=version+1 WHERE id=$1",
        [id],
      );
      await c.audit(q, tenant, user, "return.pending", id);
      return { value: { id, pending: true } };
    }
    requireThat(
      d.appointment_at &&
        Date.parse(d.pickup_at) > new Date(course.pickup_at).getTime(),
      400,
      "VALIDATION_ERROR",
    );
    const returnId = await insertCourse(
      q,
      tenant,
      {
        reference: course.reference + "-R",
        origin: course.destination,
        destination: course.origin,
        pickup_at: d.pickup_at,
        appointment_at: d.appointment_at,
        arrival_buffer: 0,
        passengers: course.passengers,
        accessible: course.accessible,
      },
      { returnOf: id },
    );
    requireThat(returnId, 409, "RETURN_EXISTS");
    await q.query(
      "UPDATE courses SET return_pending=false,version=version+1 WHERE id=$1",
      [id],
    );
    await c.audit(q, tenant, user, "return.scheduled", returnId);
    return { value: { id: returnId, pending: false } };
  }
  if (path === "/imports/preview" || path === "/imports/courses") {
    manage();
    const d = z
      .object({ rows: z.array(types.courseInput).min(1).max(100) })
      .strict()
      .parse(body);
    const duplicateIndexes: number[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < d.rows.length; i++) {
      const r = d.rows[i],
        key = [r.reference, r.pickup_at, r.origin, r.destination].join("|");
      if (
        seen.has(key) ||
        (
          await q.query(
            "SELECT 1 FROM courses WHERE reference=$1 AND pickup_at=$2 AND origin=$3 AND destination=$4",
            [r.reference, r.pickup_at, r.origin, r.destination],
          )
        ).rows.length
      )
        duplicateIndexes.push(i);
      seen.add(key);
    }
    if (path === "/imports/preview")
      return {
        value: { valid: d.rows.length, duplicate_indexes: duplicateIndexes },
      };
    let imported = 0;
    for (let i = 0; i < d.rows.length; i++)
      if (!duplicateIndexes.includes(i)) {
        const id = await insertCourse(q, tenant, d.rows[i]);
        if (id) {
          imported++;
          await c.audit(q, tenant, user, "course.imported", id);
        }
      }
    return { value: { imported, skipped: duplicateIndexes.length } };
  }
}
