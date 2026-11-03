import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import inject from "light-my-request";
import { connect, migrate, scoped, type Database } from "../apps/api/src/db";
import { createApp } from "../apps/api/src/server";
import { seed, ids } from "../apps/api/src/seed";
import type { INestApplication } from "@nestjs/common";
const password = "Synthetic-demo-only-2026";
let db: Database, app: INestApplication;
type Account = { cookie: string; csrf: string; tenant: string; id: string };
let a: Account, b: Account, driver: Account, viewer: Account;
async function request(
  method: string,
  path: string,
  account?: Account,
  payload?: any,
  key = randomUUID(),
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (account)
    Object.assign(headers, {
      cookie: account.cookie,
      "x-tenant-id": account.tenant,
      "x-csrf-token": account.csrf,
      "idempotency-key": key,
    });
  const result = await inject(app.getHttpAdapter().getInstance(), {
    method: method as any,
    url: "/api/v1" + path,
    headers,
    ...(payload === undefined ? {} : { payload }),
  });
  return {
    status: result.statusCode,
    body: result.json(),
    headers: result.headers,
  };
}
async function login(email: string, tenant = ids.a) {
  const r = await request("POST", "/auth/login", undefined, {
    email,
    password,
  });
  assert.equal(r.status, 200);
  const cookie = String(r.headers["set-cookie"]).split(";")[0];
  const temp = { cookie, csrf: r.body.csrf, tenant, id: "" };
  const me = await request("GET", "/auth/me", temp);
  return { ...temp, id: me.body.id };
}
const course = (extra: any = {}) => ({
  reference: "DEMO-TEST",
  origin: "loc-1",
  destination: "loc-3",
  pickup_at: "2026-11-04T09:00:00+01:00",
  appointment_at: "2026-11-04T10:00:00+01:00",
  arrival_buffer: 15,
  passengers: 1,
  ...extra,
});
async function resources(account = a) {
  return {
    drivers: (await request("GET", "/drivers", account)).body,
    vehicles: (await request("GET", "/vehicles", account)).body,
  };
}
async function newCourse(extra: any = {}, account = a) {
  const r = await request("POST", "/courses", account, course(extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
}
async function assign(id: string, did: string, vid: string, account = a) {
  return request("POST", `/courses/${id}/assign`, account, {
    driver_id: did,
    vehicle_id: vid,
    version: 1,
  });
}
before(async () => {
  db = await connect(process.env.TEST_DATABASE_URL, true);
  await migrate(db);
  await migrate(db);
  await seed(db, password);
  app = await createApp(db, { demo: true });
  a = await login("admin@atlas.example");
  b = await login("admin@horizon.example", ids.b);
  driver = await login("driver@atlas.example");
  viewer = await login("viewer@atlas.example");
});
after(async () => {
  await app?.close();
  await db?.close();
});
test("authentication is required and passwords are never returned", async () => {
  const r = await request("GET", "/auth/me");
  assert.equal(r.status, 401);
  const me = await request("GET", "/auth/me", a);
  assert.ok(!JSON.stringify(me.body).includes("password"));
  assert.match(
    String(
      (
        await request("POST", "/auth/login", undefined, {
          email: "nobody@example.test",
          password: "bad",
        })
      ).body.code,
    ),
    /INVALID_CREDENTIALS/,
  );
});
test("sessions use HttpOnly SameSite cookies", async () => {
  const r = await request("POST", "/auth/login", undefined, {
    email: "admin@atlas.example",
    password,
  });
  assert.match(String(r.headers["set-cookie"]), /HttpOnly; SameSite=Strict/);
});
test("tenant header alone never authorizes access", async () => {
  const r = await request("GET", "/courses", { ...a, tenant: ids.b });
  assert.equal(r.status, 403);
});
test("cross-tenant list and known UUID reads do not leak", async () => {
  const other = (await request("GET", "/courses", b)).body;
  assert.equal(other.length, 4);
  const mine = (await request("GET", "/courses", a)).body;
  assert.ok(mine.every((c: any) => c.tenant_id === ids.a));
  assert.equal(
    (await request("GET", "/courses/" + other[0].id, a)).status,
    404,
  );
});
test("database RLS blocks raw cross-tenant reads and writes", async () => {
  await scoped(db, ids.a, async (q) => {
    assert.equal(
      (await q.query("SELECT * FROM courses WHERE tenant_id=$1", [ids.b])).rows
        .length,
      0,
    );
    assert.equal(
      (await q.query("SELECT * FROM tenants WHERE id=$1", [ids.b])).rows.length,
      0,
    );
  });
  await assert.rejects(
    scoped(db, ids.a, (q) =>
      q.query(
        "INSERT INTO vehicles(id,tenant_id,label,seats) VALUES($1,$2,$3,4)",
        [randomUUID(), ids.b, "forbidden"],
      ),
    ),
    /row-level security/,
  );
});
test("drivers see only assigned personal missions; viewer sees none", async () => {
  assert.equal((await request("GET", "/courses", driver)).body.length, 0);
  assert.equal((await request("GET", "/drivers", driver)).body.length, 1);
  assert.equal((await request("GET", "/courses", viewer)).body.length, 0);
  assert.equal((await request("GET", "/vehicles", driver)).status, 403);
});
test("driver cannot write resources or invite/promote himself", async () => {
  assert.equal(
    (await request("POST", "/vehicles", driver, { label: "bad", seats: 4 }))
      .status,
    403,
  );
  assert.equal(
    (
      await request("POST", "/invitations", driver, {
        email: "hacker@example.test",
        role: "admin",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("POST", "/invitations", a, {
        email: "hacker@example.test",
        role: "admin",
      })
    ).status,
    400,
  );
});
test("CSRF and disallowed origins reject mutations", async () => {
  assert.equal(
    (
      await request(
        "POST",
        "/groups",
        { ...a, csrf: "invalid" },
        { name: "bad" },
      )
    ).status,
    403,
  );
  const r = await inject(app.getHttpAdapter().getInstance(), {
    method: "POST",
    url: "/api/v1/auth/login",
    headers: {
      origin: "https://evil.example",
      "content-type": "application/json",
    },
    payload: { email: "admin@atlas.example", password },
  });
  assert.equal(r.statusCode, 403);
});
test("course idempotency replays same result and rejects different payload", async () => {
  const key = randomUUID();
  const r = await request("POST", "/courses", a, course(), key);
  const again = await request("POST", "/courses", a, course(), key);
  assert.deepEqual(r.body, again.body);
  const changed = await request(
    "POST",
    "/courses",
    a,
    course({ reference: "different" }),
    key,
  );
  assert.equal(changed.status, 409);
});
test("arrival deadline subtracts the margin with explicit timezone", async () => {
  const id = await newCourse({ appointment_at: "2026-11-04T10:30:00+01:00" });
  const r = await request("GET", "/courses/" + id, a);
  assert.equal(r.body.dropoff_deadline, "2026-11-04T09:15:00.000Z");
});
test("local-day filtering works at UTC boundary and rejects invalid dates", async () => {
  const id = await newCourse({
    pickup_at: "2026-07-01T00:10:00+02:00",
    appointment_at: "2026-07-01T01:30:00+02:00",
  });
  const r = await request("GET", "/courses?date=2026-07-01", a);
  assert.ok(r.body.some((x: any) => x.id === id));
  assert.equal(
    (await request("GET", "/courses?date=not-a-date", a)).status,
    400,
  );
});
test("unknown fields and ambiguous local timestamps are rejected", async () => {
  assert.equal(
    (await request("POST", "/courses", a, course({ tenant_id: ids.b }))).status,
    400,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/courses",
        a,
        course({ pickup_at: "2026-11-04T09:00:00" }),
      )
    ).status,
    400,
  );
});
test("50 simultaneous assignments to one course yield exactly one success", async () => {
  const { drivers, vehicles } = await resources();
  const id = await newCourse();
  const results = await Promise.all(
    Array.from({ length: 50 }, () => assign(id, drivers[0].id, vehicles[0].id)),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 49);
  const own = await request("GET", "/courses", driver);
  assert.ok(own.body.some((c: any) => c.id === id));
});
test("shared chauffeur or shared vehicle cannot overlap", async () => {
  const { drivers, vehicles } = await resources();
  const id = await newCourse();
  assert.equal(
    (await assign(id, drivers[0].id, vehicles[1].id)).body.code,
    "RESOURCE_CONFLICT",
  );
  assert.equal(
    (await assign(id, drivers[1].id, vehicles[0].id)).body.code,
    "RESOURCE_CONFLICT",
  );
});
test("assignment refuses resources owned by another tenant", async () => {
  const { drivers, vehicles } = await resources(b);
  const id = await newCourse();
  assert.equal((await assign(id, drivers[0].id, vehicles[0].id)).status, 404);
});
test("shift, breaks, vehicle capacity, deadline and route are hard constraints", async () => {
  const { drivers, vehicles } = await resources();
  const cases = [
    [
      {
        pickup_at: "2026-11-04T05:00:00+01:00",
        appointment_at: "2026-11-04T06:00:00+01:00",
      },
      "SHIFT_CONFLICT",
    ],
    [
      {
        pickup_at: "2026-11-04T12:00:00+01:00",
        appointment_at: "2026-11-04T13:00:00+01:00",
      },
      "BREAK_CONFLICT",
    ],
    [
      {
        pickup_at: "2026-11-04T17:00:00+01:00",
        appointment_at: "2026-11-04T18:00:00+01:00",
        passengers: 5,
      },
      "VEHICLE_INCOMPATIBLE",
    ],
    [
      {
        pickup_at: "2026-11-04T17:00:00+01:00",
        appointment_at: "2026-11-04T17:30:00+01:00",
      },
      "TIME_WINDOW_CONFLICT",
    ],
  ] as const;
  for (const [extra, code] of cases) {
    const id = await newCourse(extra);
    assert.equal(
      (await assign(id, drivers[1].id, vehicles[1].id)).body.code,
      code,
    );
  }
  await db.query(
    "UPDATE routes SET expires_at=now()-interval '1 minute' WHERE origin='loc-2' AND destination='loc-3'",
  );
  const id = await newCourse({
    origin: "loc-2",
    pickup_at: "2026-11-04T17:00:00+01:00",
    appointment_at: "2026-11-04T18:00:00+01:00",
  });
  assert.equal(
    (await assign(id, drivers[1].id, vehicles[1].id)).body.code,
    "ROUTE_UNAVAILABLE",
  );
  await db.query(
    "UPDATE routes SET expires_at=now()+interval '1 year' WHERE origin='loc-2' AND destination='loc-3'",
  );
});
test("repositioning uses last dropoff, refuses insufficient time", async () => {
  const { drivers, vehicles } = await resources();
  const id = await newCourse({
    origin: "loc-2",
    pickup_at: "2026-11-04T09:35:00+01:00",
    appointment_at: "2026-11-04T10:30:00+01:00",
  });
  assert.equal(
    (await assign(id, drivers[0].id, vehicles[0].id)).body.code,
    "TRANSFER_CONFLICT",
  );
});
test("private groups are isolated; shared demo group is visible to both members", async () => {
  const r = await request("POST", "/groups", a, { name: "Atlas privé" });
  assert.equal(r.status, 201);
  const mine = (await request("GET", "/groups", a)).body;
  const others = (await request("GET", "/groups", b)).body;
  assert.ok(mine.some((x: any) => x.id === r.body.id));
  assert.ok(!others.some((x: any) => x.id === r.body.id));
  assert.ok(others.some((x: any) => x.id === ids.group));
});
test("invitations store only a hash and revoke immediately", async () => {
  const r = await request("POST", "/invitations", a, {
    email: "admin@horizon.example",
    role: "driver",
  });
  assert.equal(r.status, 201);
  const raw = (
    await db.query("SELECT token_hash FROM invitations WHERE id=$1", [
      r.body.id,
    ])
  ).rows[0];
  assert.notEqual(raw.token_hash, r.body.token);
  const records = JSON.stringify(
    (await db.query("SELECT * FROM idempotency")).rows,
  );
  assert.ok(!records.includes(r.body.token));
  await request("POST", `/invitations/${r.body.id}/revoke`, a, {});
  assert.equal(
    (await request("POST", "/invitations/accept", b, { token: r.body.token }))
      .body.code,
    "INVITATION_INVALID",
  );
});
test("invitation expiry, recipient and one-use acceptance are checked", async () => {
  let r = await request("POST", "/invitations", a, {
    email: "admin@horizon.example",
    role: "dispatcher",
  });
  await db.query(
    "UPDATE invitations SET expires_at=now()-interval '1 hour' WHERE id=$1",
    [r.body.id],
  );
  assert.equal(
    (await request("POST", "/invitations/accept", b, { token: r.body.token }))
      .status,
    400,
  );
  r = await request("POST", "/invitations", a, {
    email: "admin@horizon.example",
    role: "dispatcher",
  });
  assert.equal(
    (
      await request("POST", "/invitations/accept", driver, {
        token: r.body.token,
      })
    ).status,
    400,
  );
  const accepted = await request("POST", "/invitations/accept", b, {
    token: r.body.token,
  });
  assert.equal(accepted.status, 200);
  assert.equal(
    (await request("POST", "/invitations/accept", b, { token: r.body.token }))
      .status,
    400,
  );
});
test("documents remain disabled even for administrators", async () => {
  assert.equal(
    (await request("POST", "/documents", a, {})).body.code,
    "DOCUMENTS_DISABLED",
  );
});
test("audit is append-only for the runtime database role and restricted to admins", async () => {
  assert.equal((await request("GET", "/audit", driver)).status, 403);
  const r = await request("GET", "/audit", a);
  assert.ok(r.body.some((x: any) => x.action === "course.assigned"));
  assert.ok(!JSON.stringify(r.body).includes(password));
  await assert.rejects(
    scoped(db, ids.a, (q) => q.query("DELETE FROM audit_events")),
    /permission denied/,
  );
});
test("membership revocation and logout revoke subsequent reads", async () => {
  await db.query(
    "UPDATE memberships SET active=false WHERE tenant_id=$1 AND user_id=$2",
    [ids.a, viewer.id],
  );
  assert.equal((await request("GET", "/courses", viewer)).status, 403);
  const r = await request("POST", "/auth/logout", viewer, {});
  assert.equal(r.status, 200);
  assert.equal((await request("GET", "/auth/me", viewer)).status, 401);
});

test("vehicle repositioning is checked even when its next driver is different", async () => {
  const { drivers, vehicles } = await resources();
  const id = await newCourse({
    origin: "loc-2",
    pickup_at: "2026-11-04T09:35:00+01:00",
    appointment_at: "2026-11-04T10:30:00+01:00",
  });
  assert.equal(
    (await assign(id, drivers[1].id, vehicles[0].id)).body.code,
    "TRANSFER_CONFLICT",
  );
});
test("mission transitions cannot skip states or use a stale version", async () => {
  const { drivers, vehicles } = await resources();
  const id = await newCourse({
    pickup_at: "2026-11-04T16:00:00+01:00",
    appointment_at: "2026-11-04T17:00:00+01:00",
  });
  assert.equal((await assign(id, drivers[0].id, vehicles[0].id)).status, 201);
  assert.equal(
    (
      await request("POST", `/courses/${id}/status`, driver, {
        status: "completed",
        version: 2,
      })
    ).body.code,
    "INVALID_TRANSITION",
  );
  assert.equal(
    (
      await request("POST", `/courses/${id}/status`, driver, {
        status: "approaching",
        version: 1,
      })
    ).body.code,
    "PLAN_STALE",
  );
  let version = 2;
  for (const status of ["approaching", "onboard", "completed"]) {
    const r = await request("POST", `/courses/${id}/status`, driver, {
      status,
      version,
    });
    assert.equal(r.status, 201);
    version++;
  }
  assert.equal(
    (
      await request("POST", `/courses/${id}/status`, a, {
        status: "cancelled",
        version,
      })
    ).body.code,
    "INVALID_TRANSITION",
  );
});
