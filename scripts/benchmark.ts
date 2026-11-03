import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import inject from "light-my-request";
import { connect, migrate, asRole } from "../apps/api/src/db";
import { seed, ids } from "../apps/api/src/seed";
import { createApp } from "../apps/api/src/server";
async function main() {
  const db = await connect(undefined, true);
  await migrate(db);
  const password = "benchmark-synthetic-only-password";
  await seed(db, password);
  const day = "2026-11-09";
  await db.transaction(async (q) => {
    for (let i = 0; i < 20; i++) {
      await q.query(
        "INSERT INTO drivers(id,tenant_id,name,shift_start,shift_end,start_location,end_location,breaks) VALUES($1,$2,$3,$4,$5,$6,$6,$7)",
        [
          randomUUID(),
          ids.a,
          "Benchmark " + i,
          day + "T06:00:00+01:00",
          day + "T19:00:00+01:00",
          "loc-0",
          JSON.stringify([
            { start: day + "T12:00:00+01:00", end: day + "T12:30:00+01:00" },
          ]),
        ],
      );
      await q.query(
        "INSERT INTO vehicles(id,tenant_id,label,seats) VALUES($1,$2,$3,4)",
        [randomUUID(), ids.a, "Benchmark car " + i],
      );
    }
    for (const hour of ["08", "09", "10", "13", "14"])
      for (let j = 0; j < 20; j++)
        await q.query(
          "INSERT INTO courses(id,tenant_id,reference,origin,destination,pickup_at,appointment_at,arrival_buffer,passengers) VALUES($1,$2,$3,$4,$5,$6,$7,15,1)",
          [
            randomUUID(),
            ids.a,
            "BENCH-" + hour + "-" + j,
            "loc-1",
            "loc-3",
            day + "T" + hour + ":00:00+01:00",
            day +
              "T" +
              String(Number(hour) + 1).padStart(2, "0") +
              ":00:00+01:00",
          ],
        );
  });
  const app = await createApp(
    db,
    { demo: true },
    asRole(db, "taxilink_identity"),
  );
  try {
    const login = await inject(app.getHttpAdapter().getInstance(), {
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "admin@atlas.example", password },
    });
    const csrf = login.json().csrf,
      cookie = String(login.headers["set-cookie"]).split(";")[0];
    const started = performance.now();
    const response = await inject(app.getHttpAdapter().getInstance(), {
      method: "POST",
      url: "/api/v1/plans/propose",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": ids.a,
        cookie,
        "x-csrf-token": csrf,
        "idempotency-key": randomUUID(),
      },
      payload: { date: day },
    });
    const body = response.json(),
      elapsed = Math.round(performance.now() - started);
    if (
      response.statusCode !== 201 ||
      body.assigned.length !== 100 ||
      elapsed > 60000
    )
      throw new Error(
        "Benchmark failed: " +
          JSON.stringify({
            status: response.statusCode,
            assigned: body.assigned?.length,
            elapsed_ms: elapsed,
            code: body.code,
          }),
      );
    console.log(
      JSON.stringify({
        courses: 100,
        eligible_drivers: 20,
        assigned: body.assigned.length,
        unassigned: body.unassigned.length,
        elapsed_ms: elapsed,
        database: "PGlite",
        real_routing: false,
      }),
    );
  } finally {
    await app.close();
    await db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
