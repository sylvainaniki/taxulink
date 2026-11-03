import { Fault, requireThat } from "./security";
import type { Sql, Row } from "./db";
const ms = (v: any) => new Date(v).getTime();
export const overlaps = (a: number, b: number, c: number, d: number) =>
  a < d && c < b;
export async function route(q: Sql, from: string, to: string) {
  const r = (
    await q.query(
      "SELECT minutes FROM routes WHERE origin=$1 AND destination=$2 AND expires_at>now()",
      [from, to],
    )
  ).rows[0];
  requireThat(r, 422, "ROUTE_UNAVAILABLE");
  return Number(r.minutes) * 60000;
}
export async function validateAssignment(
  q: Sql,
  course: Row,
  driver: Row,
  vehicle: Row,
) {
  requireThat(driver.active && vehicle.active, 422, "RESOURCE_INACTIVE");
  requireThat(
    vehicle.seats >= course.passengers &&
      (!course.accessible || vehicle.accessible),
    422,
    "VEHICLE_INCOMPATIBLE",
  );
  const start = ms(course.pickup_at);
  // 5 minutes boarding + routed travel + 5 minutes drop-off service.
  const arrival =
    start + 5 * 60000 + (await route(q, course.origin, course.destination));
  const end = arrival + 5 * 60000;
  requireThat(
    arrival <= ms(course.appointment_at) - course.arrival_buffer * 60000,
    422,
    "TIME_WINDOW_CONFLICT",
  );
  requireThat(
    start >= ms(driver.shift_start) && end <= ms(driver.shift_end),
    422,
    "SHIFT_CONFLICT",
  );
  const occupied = (
    await q.query(
      `SELECT a.*,c.origin,c.destination FROM assignments a JOIN courses c ON c.id=a.course_id WHERE (a.driver_id=$1 OR a.vehicle_id=$2) AND c.status<>'cancelled' ORDER BY a.start_at`,
      [driver.id, vehicle.id],
    )
  ).rows;
  requireThat(
    !occupied.some((a) => overlaps(start, end, ms(a.start_at), ms(a.end_at))),
    422,
    "RESOURCE_CONFLICT",
  );
  // The vehicle must also be able to move between jobs, even with different drivers.
  const vehicleJobs = occupied.filter((a) => a.vehicle_id === vehicle.id);
  const vehiclePrev = vehicleJobs.filter((a) => ms(a.end_at) <= start).at(-1);
  const vehicleNext = vehicleJobs.find((a) => ms(a.start_at) >= end);
  const vehicleTransfer = await route(
    q,
    vehiclePrev?.destination || vehicle.start_location,
    course.origin,
  );
  requireThat(
    (vehiclePrev ? ms(vehiclePrev.end_at) : ms(driver.shift_start)) +
      vehicleTransfer <=
      start,
    422,
    "TRANSFER_CONFLICT",
  );
  if (vehicleNext)
    requireThat(
      end + (await route(q, course.destination, vehicleNext.origin)) <=
        ms(vehicleNext.start_at),
      422,
      "TRANSFER_CONFLICT",
    );
  const jobs = occupied.filter((a) => a.driver_id === driver.id);
  const prev = jobs.filter((a) => ms(a.end_at) <= start).at(-1);
  const next = jobs.find((a) => ms(a.start_at) >= end);
  const from = prev ? prev.destination : driver.start_location;
  const available = prev ? ms(prev.end_at) : ms(driver.shift_start);
  const transfer = await route(q, from, course.origin);
  requireThat(available + transfer <= start, 422, "TRANSFER_CONFLICT");
  const to = next ? next.origin : driver.end_location;
  const limit = next ? ms(next.start_at) : ms(driver.shift_end);
  const onward = await route(q, course.destination, to);
  requireThat(end + onward <= limit, 422, "TRANSFER_CONFLICT");
  // Conservative: transfers take place immediately before pickup / after drop-off.
  for (const pause of driver.breaks) {
    if (
      overlaps(start - transfer, end + onward, ms(pause.start), ms(pause.end))
    )
      throw new Fault(422, "BREAK_CONFLICT");
  }
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  };
}
