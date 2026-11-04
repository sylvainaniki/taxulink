import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import inject from "light-my-request";
import {
  connect,
  migrate,
  scoped,
  asRole,
  type Database,
} from "../apps/api/src/db";
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
  app = await createApp(
    db,
    { demo: true, mfaKey: "11".repeat(32), authLimit: 100 },
    asRole(db, "taxilink_identity"),
  );
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
  assert.equal((await request("GET", "/vehicles", driver)).status, 200);
  assert.ok(
    (await request("GET", "/vehicles", driver)).body.every(
      (v: any) => !Object.hasOwn(v, "tenant_id"),
    ),
  );
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

test("private marketplace DTO exposes no source reference, course UUID or passenger identifier", async () => {
  const id = await newCourse({
    reference: "SECRET-PASSENGER-REF",
    pickup_at: "2026-11-04T17:00:00+01:00",
    appointment_at: "2026-11-04T18:00:00+01:00",
  });
  const published = await request("POST", "/offers", a, {
    course_id: id,
    group_id: ids.group,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(published.status, 201, JSON.stringify(published.body));
  const offers = await request("GET", "/offers", b);
  const offer = offers.body.find((o: any) => o.id === published.body.id);
  assert.ok(offer);
  assert.ok(!JSON.stringify(offer).includes(id));
  assert.ok(!JSON.stringify(offer).includes("SECRET-PASSENGER-REF"));
  for (const key of [
    "course_id",
    "reference",
    "patient_id",
    "phone",
    "document_id",
    "notes",
  ])
    assert.ok(!Object.hasOwn(offer, key));
  const rs = await resources();
  assert.equal(
    (await assign(id, rs.drivers[0].id, rs.vehicles[0].id)).body.code,
    "COURSE_OFFERED",
  );
  await assert.rejects(
    scoped(db, ids.b, (q) => q.query("SELECT * FROM offers")),
    /permission denied/,
  );
});
test("50 competing offer claims have one reservation; only owner confirmation creates a mission", async () => {
  const offer = (await request("GET", "/offers", b)).body.find(
    (o: any) => o.status === "published",
  );
  const rs = await resources(b);
  const payload = {
    driver_id: rs.drivers[0].id,
    vehicle_id: rs.vehicles[0].id,
  };
  const keys = Array.from({ length: 50 }, () => randomUUID());
  const results = await Promise.all(
    keys.map((key) =>
      request("POST", `/offers/${offer.id}/claim`, b, payload, key),
    ),
  );
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(results),
  );
  assert.equal(results.filter((r) => r.status === 409).length, 49);
  const index = results.findIndex((r) => r.status === 201);
  assert.deepEqual(
    (
      await request(
        "POST",
        `/offers/${offer.id}/claim`,
        b,
        payload,
        keys[index],
      )
    ).body,
    results[index].body,
  );
  assert.equal((await request("GET", "/courses", b)).body.length, 4);
  const conflicting = await newCourse(
    {
      pickup_at: "2026-11-04T17:00:00+01:00",
      appointment_at: "2026-11-04T18:00:00+01:00",
    },
    b,
  );
  assert.equal(
    (await assign(conflicting, rs.drivers[0].id, rs.vehicles[0].id, b)).body
      .code,
    "RESOURCE_CONFLICT",
  );
  assert.equal(
    (
      await request("POST", `/offers/${offer.id}/decision`, b, {
        decision: "approve",
      })
    ).status,
    404,
  );
  const approved = await request("POST", `/offers/${offer.id}/decision`, a, {
    decision: "approve",
  });
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  const mission = (await request("GET", "/courses", b)).body.find(
    (x: any) => x.source_course_id,
  );
  assert.ok(mission);
  assert.equal(mission.status, "assigned");
  const bd = await login("driver@horizon.example", ids.b);
  assert.ok(
    (await request("GET", "/courses", bd)).body.some(
      (x: any) => x.id === mission.id,
    ),
  );
  assert.equal(
    (await request("GET", "/courses/" + mission.source_course_id, bd)).status,
    404,
  );
  assert.equal(
    (
      await request("POST", `/courses/${mission.id}/status`, bd, {
        status: "approaching",
        version: mission.version,
      })
    ).status,
    201,
  );
  const source = await request(
    "GET",
    "/courses/" + mission.source_course_id,
    a,
  );
  assert.equal(source.body.status, "approaching");
  assert.equal(
    (
      await request("POST", `/courses/${source.body.id}/status`, a, {
        status: "cancelled",
        version: source.body.version,
      })
    ).status,
    201,
  );
  assert.equal(
    (await request("GET", "/courses/" + mission.id, b)).body.status,
    "cancelled",
  );
});
test("withdrawal and expiry prevent claiming an offer and never grant course visibility", async () => {
  const rs = await resources(b);
  for (const mode of ["withdraw", "expire"]) {
    const cid = await newCourse({
      reference: "NO-GRANT-" + mode,
      pickup_at: "2026-11-04T18:00:00+01:00",
      appointment_at: "2026-11-04T19:00:00+01:00",
    });
    const r = await request("POST", "/offers", a, {
      course_id: cid,
      group_id: ids.group,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    assert.equal(r.status, 201);
    if (mode === "withdraw")
      await request("POST", `/offers/${r.body.id}/decision`, a, {
        decision: "withdraw",
      });
    else
      await db.query(
        "UPDATE offers SET expires_at=now()-interval '1 second' WHERE id=$1",
        [r.body.id],
      );
    assert.equal(
      (
        await request("POST", `/offers/${r.body.id}/claim`, b, {
          driver_id: rs.drivers[0].id,
          vehicle_id: rs.vehicles[0].id,
        })
      ).status,
      409,
    );
    assert.equal((await request("GET", "/courses/" + cid, b)).status, 404);
  }
});
test("network invitations, group chat and membership revocation enforce isolation immediately", async () => {
  const group = await request("POST", "/groups", a, {
    name: "Echanges privés",
  });
  const gid = group.body.id;
  assert.equal(
    (await request("GET", `/groups/${gid}/messages`, b)).status,
    404,
  );
  const invite = await request("POST", `/groups/${gid}/invite`, a, {
    tenant_id: ids.b,
  });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  const pending = await request("GET", "/network-invitations", b);
  assert.ok(pending.body.some((x: any) => x.id === invite.body.id));
  assert.equal(
    (
      await request(
        "POST",
        `/network-invitations/${invite.body.id}/accept`,
        b,
        {},
      )
    ).status,
    201,
  );
  const posted = await request("POST", `/groups/${gid}/messages`, a, {
    body: "Course fictive disponible, sans information patient.",
  });
  assert.equal(posted.status, 201);
  assert.ok(
    (await request("GET", `/groups/${gid}/messages`, b)).body.some(
      (m: any) => m.id === posted.body.id,
    ),
  );
  assert.equal(
    (
      await request("POST", `/groups/${gid}/remove-member`, a, {
        tenant_id: ids.b,
      })
    ).status,
    201,
  );
  assert.equal(
    (await request("GET", `/groups/${gid}/messages`, b)).status,
    404,
  );
  assert.equal(
    (await request("POST", `/groups/${gid}/messages`, b, { body: "Interdit" }))
      .status,
    403,
  );
});
test("planner proposes without mutation, rejects stale input, and atomically applies a feasible plan", async () => {
  const rs = await resources();
  for (const dr of rs.drivers) {
    const shift = await request("POST", "/shifts", a, {
      driver_id: dr.id,
      shift: {
        name: dr.name,
        start_location: "loc-0",
        end_location: "loc-0",
        shift_start: "2026-11-05T06:00:00+01:00",
        shift_end: "2026-11-05T19:00:00+01:00",
        breaks: [],
      },
    });
    assert.equal(shift.status, 201, JSON.stringify(shift.body));
  }
  const cid = await newCourse({
    pickup_at: "2026-11-05T09:00:00+01:00",
    appointment_at: "2026-11-05T10:00:00+01:00",
  });
  let proposed = await request("POST", "/plans/propose", a, {
    date: "2026-11-05",
  });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
  assert.equal(proposed.body.assigned.length, 1);
  assert.equal(
    (await request("GET", "/courses/" + cid, a)).body.status,
    "unassigned",
  );
  await newCourse({
    pickup_at: "2026-11-05T11:00:00+01:00",
    appointment_at: "2026-11-05T12:00:00+01:00",
  });
  assert.equal(
    (await request("POST", `/plans/${proposed.body.id}/apply`, a, {})).body
      .code,
    "PLAN_STALE",
  );
  proposed = await request("POST", "/plans/propose", a, { date: "2026-11-05" });
  assert.equal(
    (await request("POST", `/plans/${proposed.body.id}/apply`, a, {})).status,
    201,
  );
  assert.equal(
    (await request("GET", "/courses/" + cid, a)).body.status,
    "assigned",
  );
  assert.equal(
    (await request("POST", `/plans/${proposed.body.id}/apply`, a, {})).body
      .code,
    "PLAN_STALE",
  );
});
test("recurrence generation respects weekdays/exceptions and is idempotent", async () => {
  const rule = await request("POST", "/recurrences", a, {
    template: {
      reference: "REC-DEMO",
      origin: "loc-0",
      destination: "loc-1",
      pickup_time: "09:00",
      appointment_time: "10:00",
      passengers: 1,
      accessible: false,
      arrival_buffer: 15,
    },
    start_date: "2026-11-02",
    end_date: "2026-11-13",
    weekdays: [1, 4],
    exceptions: ["2026-11-05"],
    interval_weeks: 1,
  });
  assert.equal(rule.status, 201, JSON.stringify(rule.body));
  const generated = await request(
    "POST",
    `/recurrences/${rule.body.id}/generate`,
    a,
    {},
  );
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  assert.equal(generated.body.generated, 3);
  assert.equal(
    (await request("POST", `/recurrences/${rule.body.id}/generate`, a, {})).body
      .generated,
    0,
  );
  assert.equal(
    (await request("POST", `/recurrences/${rule.body.id}/stop`, a, {})).status,
    201,
  );
  assert.equal(
    (await request("POST", `/recurrences/${rule.body.id}/generate`, a, {}))
      .status,
    404,
  );
});
test("unknown return is flagged without inventing a pickup time and can be scheduled once", async () => {
  let id = await newCourse({ reference: "RETURN-DEMO" }),
    r = await request("POST", `/courses/${id}/return`, a, { version: 1 });
  assert.equal(r.body.pending, true);
  assert.ok(
    (await request("GET", "/pending-returns", a)).body.some(
      (c: any) => c.id === id,
    ),
  );
  r = await request("POST", `/courses/${id}/return`, a, {
    version: 2,
    pickup_at: "2026-11-04T15:00:00+01:00",
    appointment_at: "2026-11-04T16:00:00+01:00",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ret = await request("GET", "/courses/" + r.body.id, a);
  assert.equal(ret.body.origin, "loc-3");
  assert.equal(ret.body.destination, "loc-1");
  assert.equal(
    (await request("GET", "/courses/" + id, a)).body.return_pending,
    false,
  );
  assert.equal(
    (
      await request("POST", `/courses/${id}/return`, a, {
        version: 3,
        pickup_at: "2026-11-04T15:00:00+01:00",
        appointment_at: "2026-11-04T16:00:00+01:00",
      })
    ).body.code,
    "RETURN_EXISTS",
  );
});
test("CSV import previews duplicates, imports once, and escapes dangerous export formulas", async () => {
  const row = course({
    reference: "=FAKE-FORMULA",
    pickup_at: "2026-11-06T10:00:00+01:00",
    appointment_at: "2026-11-06T11:00:00+01:00",
  });
  const preview = await request("POST", "/imports/preview", a, {
    rows: [row, row],
  });
  assert.deepEqual(preview.body.duplicate_indexes, [1]);
  assert.equal(
    (await request("POST", "/imports/courses", a, { rows: [row, row] })).body
      .imported,
    1,
  );
  assert.equal(
    (await request("POST", "/imports/courses", a, { rows: [row] })).body
      .imported,
    0,
  );
  const exported = await request("GET", "/exports/courses", a);
  assert.ok(exported.body.rows.some((r: any) => r[0] === "'=FAKE-FORMULA"));
  assert.ok(!JSON.stringify(exported.body).includes("DEMO-HORIZON"));
});
test("contacts, analytics and member management remain tenant/role restricted", async () => {
  const contact = await request("POST", "/contacts", a, {
    name: "Centre entièrement fictif",
    kind: "facility",
    phone: "0000000000",
    address: "Adresse démo",
  });
  assert.equal(contact.status, 201);
  assert.ok(
    !(await request("GET", "/contacts", b)).body.some(
      (x: any) => x.id === contact.body.id,
    ),
  );
  assert.equal((await request("GET", "/contacts", driver)).status, 403);
  assert.ok((await request("GET", "/analytics", a)).body.total > 0);
  assert.equal((await request("GET", "/members", driver)).status, 403);
  assert.equal(
    (
      await request("POST", `/members/${a.id}/update`, a, {
        role: "driver",
        active: false,
      })
    ).body.code,
    "SELF_CHANGE_FORBIDDEN",
  );
  const memberUpdate = await request(
    "POST",
    `/members/${viewer.id}/update`,
    a,
    { role: "viewer", active: true },
  );
  assert.equal(memberUpdate.status, 201);
});

test("encrypted backup restores tenant ACLs and rejects wrong keys or an occupied database", async () => {
  const { backup, restore } = await import("../apps/api/src/backup.js");
  const key = "backup-test-only-long-enough-passphrase";
  const bytes = await backup(db, key);
  assert.ok(!bytes.toString().includes("SECRET-PASSENGER-REF"));
  assert.ok(!bytes.toString().includes(password));
  const target = await connect(undefined, true);
  try {
    await assert.rejects(
      restore(target, "wrong-key-that-is-at-least-32-characters", bytes),
      /BACKUP_AUTHENTICATION_FAILED/,
    );
    await restore(target, key, bytes);
    const own = await scoped(target, ids.a, (q) =>
      q.query("SELECT DISTINCT tenant_id FROM courses"),
    );
    assert.deepEqual(
      own.rows.map((r) => r.tenant_id),
      [ids.a],
    );
    assert.equal((await target.query("SELECT * FROM sessions")).rows.length, 0);
    await assert.rejects(
      restore(target, key, bytes),
      /RESTORE_REQUIRES_EMPTY_DATABASE/,
    );
  } finally {
    await target.close();
  }
});
test("Paris recurrence clock handles summer/winter and refuses DST gaps and ambiguity", async () => {
  const { parisDateTime } = await import("../packages/contracts/dates.js");
  assert.equal(
    parisDateTime("2026-07-01", "09:00"),
    "2026-07-01T07:00:00.000Z",
  );
  assert.equal(
    parisDateTime("2026-11-04", "09:00"),
    "2026-11-04T08:00:00.000Z",
  );
  assert.throws(
    () => parisDateTime("2026-03-29", "02:30"),
    /INVALID_LOCAL_TIME/,
  );
  assert.throws(
    () => parisDateTime("2026-10-25", "02:30"),
    /AMBIGUOUS_LOCAL_TIME/,
  );
});
test("CSV parser preserves quoted separators and rejects malformed files", async () => {
  const { parseCsv } = await import("../packages/contracts/csv.js");
  const text =
    'reference;origin;destination;pickup_at;appointment_at;passengers\n"DEMO;A";loc-0;loc-1;2026-11-04T09:00:00+01:00;2026-11-04T10:00:00+01:00;1';
  assert.equal(parseCsv(text)[0].reference, "DEMO;A");
  assert.throws(() => parseCsv("a;b\n1;2"), /CSV_HEADERS_INVALID/);
  assert.throws(
    () =>
      parseCsv(
        'reference;origin;destination;pickup_at;appointment_at;passengers\n"x',
      ),
    /CSV_QUOTING_INVALID/,
  );
});

test("direct and mission conversations require explicit participants and current permissions", async () => {
  const direct = await request("POST", "/conversations", a, {
    kind: "direct",
    user_id: driver.id,
  });
  assert.equal(direct.status, 201, JSON.stringify(direct.body));
  const sent = await request(
    "POST",
    `/conversations/${direct.body.id}/messages`,
    a,
    { body: "Message opérationnel fictif" },
  );
  assert.equal(sent.status, 201);
  assert.ok(
    (
      await request("GET", `/conversations/${direct.body.id}/messages`, driver)
    ).body.some((m: any) => m.id === sent.body.id),
  );
  assert.equal(
    (await request("GET", `/conversations/${direct.body.id}/messages`, b))
      .status,
    404,
  );
  const rs = await resources(),
    job = (await request("GET", "/courses", a)).body.find(
      (c: any) => c.driver_id === rs.drivers[0].id && !c.source_course_id,
    );
  const conversation = await request("POST", "/conversations", driver, {
    kind: "course",
    course_id: job.id,
  });
  assert.equal(conversation.status, 201, JSON.stringify(conversation.body));
  assert.equal(
    (
      await request(
        "POST",
        `/conversations/${conversation.body.id}/messages`,
        driver,
        { body: "Je prends cette mission." },
      )
    ).status,
    201,
  );
  assert.equal(
    (await request("GET", `/conversations/${conversation.body.id}/messages`, a))
      .body.length,
    1,
  );
  assert.equal(
    (
      await request("POST", "/conversations", b, {
        kind: "course",
        course_id: job.id,
      })
    ).status,
    404,
  );
  await request("POST", `/members/${driver.id}/update`, a, {
    role: "viewer",
    active: true,
  });
  assert.equal(
    (await request("GET", `/conversations/${direct.body.id}/messages`, driver))
      .status,
    404,
  );
  await request("POST", `/members/${driver.id}/update`, a, {
    role: "driver",
    active: true,
  });
});
test("mobile bearer sessions expose only a token hash in storage and revoke on logout", async () => {
  const result = await request("POST", "/auth/mobile-login", undefined, {
    email: "driver@atlas.example",
    password,
  });
  assert.equal(result.status, 200);
  assert.match(result.body.token, /^[a-f0-9]{64}$/);
  assert.equal(result.headers["set-cookie"], undefined);
  const headers = {
    authorization: "Bearer " + result.body.token,
    "content-type": "application/json",
    "x-csrf-token": result.body.csrf,
  };
  let response = await inject(app.getHttpAdapter().getInstance(), {
    method: "GET",
    url: "/api/v1/auth/me",
    headers,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(
    (
      await db.query("SELECT 1 FROM sessions WHERE token_hash=$1", [
        result.body.token,
      ])
    ).rows.length,
    0,
  );
  response = await inject(app.getHttpAdapter().getInstance(), {
    method: "POST",
    url: "/api/v1/auth/logout",
    headers,
    payload: {},
  });
  assert.equal(response.statusCode, 200);
  assert.equal(
    (
      await inject(app.getHttpAdapter().getInstance(), {
        method: "GET",
        url: "/api/v1/auth/me",
        headers,
      })
    ).statusCode,
    401,
  );
});
test("password changes require the old password and revoke all existing sessions", async () => {
  const r = await request("POST", "/auth/register", undefined, {
    email: "password-test@fiction.example",
    password,
    company: "Sécurité Démo",
  });
  assert.equal(r.status, 201);
  const account = {
    cookie: String(r.headers["set-cookie"]).split(";")[0],
    csrf: r.body.csrf,
    tenant: r.body.tenant_id,
    id: "",
  };
  assert.equal(
    (
      await request("POST", "/auth/change-password", account, {
        old_password: "wrong-password",
        new_password: "New-synthetic-password-2026",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("POST", "/auth/change-password", account, {
        old_password: password,
        new_password: "New-synthetic-password-2026",
      })
    ).status,
    200,
  );
  assert.equal((await request("GET", "/auth/me", account)).status, 401);
});

test("one offer shared across two groups still has one winner and reveals only the viewer’s group", async () => {
  const registered = await request("POST", "/auth/register", undefined, {
    email: "admin@third-network.example",
    password,
    company: "Troisième Démo",
  });
  assert.equal(registered.status, 201);
  const third = {
    cookie: String(registered.headers["set-cookie"]).split(";")[0],
    csrf: registered.body.csrf,
    tenant: registered.body.tenant_id,
    id: "",
  };
  const dr = await request("POST", "/drivers", third, {
    name: "Chauffeur troisième démo",
    start_location: "loc-0",
    end_location: "loc-0",
    shift_start: "2026-11-04T06:00:00+01:00",
    shift_end: "2026-11-04T19:00:00+01:00",
    breaks: [],
  });
  const car = await request("POST", "/vehicles", third, {
    label: "Troisième véhicule",
    seats: 4,
    accessible: false,
  });
  assert.equal(dr.status, 201);
  assert.equal(car.status, 201);
  const group = await request("POST", "/groups", a, {
      name: "Second groupe de publication",
    }),
    gid = group.body.id;
  const inv = await request("POST", `/groups/${gid}/invite`, a, {
    tenant_id: third.tenant,
  });
  await request(
    "POST",
    `/network-invitations/${inv.body.id}/accept`,
    third,
    {},
  );
  const cid = await newCourse({
    reference: "MULTI-GROUP-PRIVATE-REF",
    pickup_at: "2026-11-04T18:00:00+01:00",
    appointment_at: "2026-11-04T19:00:00+01:00",
  });
  const offer = await request("POST", "/offers", a, {
    course_id: cid,
    group_ids: [ids.group, gid],
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(offer.status, 201, JSON.stringify(offer.body));
  const visible = (await request("GET", "/offers", third)).body.find(
    (o: any) => o.id === offer.body.id,
  );
  assert.equal(visible.group_id, gid);
  assert.ok(!JSON.stringify(visible).includes(ids.group));
  assert.ok(!JSON.stringify(visible).includes(cid));
  const br = await resources(b);
  const claims = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      i % 2
        ? request("POST", `/offers/${offer.body.id}/claim`, third, {
            driver_id: dr.body.id,
            vehicle_id: car.body.id,
          })
        : request("POST", `/offers/${offer.body.id}/claim`, b, {
            driver_id: br.drivers[0].id,
            vehicle_id: br.vehicles[0].id,
          }),
    ),
  );
  assert.equal(claims.filter((r) => r.status === 201).length, 1);
  assert.equal(claims.filter((r) => r.status === 409).length, 49);
  assert.equal(
    (
      await request("POST", `/offers/${offer.body.id}/decision`, a, {
        decision: "approve",
      })
    ).status,
    201,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM courses WHERE source_course_id=$1", [cid]))
      .rows.length,
    1,
  );
});

test("owner cannot confirm a reservation after the executing driver’s access was revoked", async () => {
  const rs = await resources(b),
    dr = rs.drivers[0],
    member = (await request("GET", "/members", b)).body.find(
      (m: any) => m.role === "driver",
    );
  assert.equal(
    (
      await request("POST", "/shifts", b, {
        driver_id: dr.id,
        shift: {
          name: dr.name,
          start_location: "loc-0",
          end_location: "loc-0",
          shift_start: "2026-11-07T06:00:00+01:00",
          shift_end: "2026-11-07T19:00:00+01:00",
          breaks: [],
        },
      })
    ).status,
    201,
  );
  const cid = await newCourse({
    pickup_at: "2026-11-07T10:00:00+01:00",
    appointment_at: "2026-11-07T11:00:00+01:00",
  });
  const offer = await request("POST", "/offers", a, {
    course_id: cid,
    group_id: ids.group,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(
    (
      await request("POST", `/offers/${offer.body.id}/claim`, b, {
        driver_id: dr.id,
        vehicle_id: rs.vehicles[0].id,
      })
    ).status,
    201,
  );
  await request("POST", `/members/${member.user_id}/update`, b, {
    role: "driver",
    active: false,
  });
  assert.equal(
    (
      await request("POST", `/offers/${offer.body.id}/decision`, a, {
        decision: "approve",
      })
    ).status,
    403,
  );
  assert.equal(
    (await db.query("SELECT 1 FROM courses WHERE source_course_id=$1", [cid]))
      .rows.length,
    0,
  );
  await request("POST", `/offers/${offer.body.id}/decision`, a, {
    decision: "reject",
  });
  await request("POST", `/members/${member.user_id}/update`, b, {
    role: "driver",
    active: true,
  });
});

test("customer identity is shared only with the confirmed executor, without sharing the owner’s contact file", async () => {
  const contact = await request("POST", "/contacts", a, {
    name: "PATIENT-FICTIF-NON-PUBLIC",
    kind: "customer",
    phone: "0099999999",
    address: "Adresse entièrement fictive",
  });
  assert.equal(contact.status, 201);
  assert.equal(
    (
      await request(
        "POST",
        "/courses",
        b,
        course({ customer_id: contact.body.id }),
      )
    ).status,
    404,
  );
  const cid = await newCourse({
    customer_id: contact.body.id,
    pickup_at: "2026-11-04T10:00:00+01:00",
    appointment_at: "2026-11-04T11:00:00+01:00",
  });
  const source = await request("GET", "/courses/" + cid, a);
  assert.equal(source.body.passenger_name, "PATIENT-FICTIF-NON-PUBLIC");
  const offered = await request("POST", "/offers", a, {
    course_id: cid,
    group_id: ids.group,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  });
  const dto = (await request("GET", "/offers", b)).body.find(
    (o: any) => o.id === offered.body.id,
  );
  assert.ok(!JSON.stringify(dto).includes("PATIENT-FICTIF"));
  assert.ok(!JSON.stringify(dto).includes("0099999999"));
  assert.ok(!JSON.stringify(dto).includes(contact.body.id));
  const rs = await resources(b);
  assert.equal(
    (
      await request("POST", `/offers/${offered.body.id}/claim`, b, {
        driver_id: rs.drivers[0].id,
        vehicle_id: rs.vehicles[0].id,
      })
    ).status,
    201,
  );
  assert.ok(
    !(await request("GET", "/courses", b)).body.some(
      (c: any) => c.source_course_id === cid,
    ),
  );
  assert.equal(
    (
      await request("POST", `/offers/${offered.body.id}/decision`, a, {
        decision: "approve",
      })
    ).status,
    201,
  );
  const execution = (await request("GET", "/courses", b)).body.find(
    (c: any) => c.source_course_id === cid,
  );
  assert.equal(execution.passenger_name, "PATIENT-FICTIF-NON-PUBLIC");
  assert.equal(execution.passenger_phone, "0099999999");
  assert.equal(execution.customer_id, null);
  assert.ok(
    !(await request("GET", "/contacts", b)).body.some(
      (c: any) => c.id === contact.body.id,
    ),
  );
});

test("identity and business roles cannot read each other’s private tables or escalate back to the database owner", async () => {
  await assert.rejects(
    asRole(db, "taxilink_app").query("SELECT password_hash FROM users"),
    /permission denied/,
  );
  await assert.rejects(
    asRole(db, "taxilink_identity").query("SELECT * FROM courses"),
    /permission denied/,
  );
  if (!process.env.TEST_DATABASE_URL) return;
  const { provision } = await import("../scripts/provision.js");
  const apiPass = "ci-api-runtime-password-only-1234567890",
    authPass = "ci-auth-runtime-password-only-123456789";
  await provision(process.env.TEST_DATABASE_URL, apiPass, authPass);
  const apiUrl = new URL(process.env.TEST_DATABASE_URL),
    authUrl = new URL(process.env.TEST_DATABASE_URL);
  apiUrl.username = "taxilink_api";
  apiUrl.password = apiPass;
  authUrl.username = "taxilink_auth";
  authUrl.password = authPass;
  const runtime = await connect(apiUrl.toString(), false, "taxilink_app"),
    identity = await connect(authUrl.toString(), false, "taxilink_identity");
  const restricted = await createApp(runtime, { demo: true }, identity);
  try {
    const { assertRuntimePrivileges } = await import("../apps/api/src/db.js");
    await assertRuntimePrivileges(runtime, identity);
    await assert.rejects(
      assertRuntimePrivileges(db, identity),
      /Privileged or mixed/,
    );
    await assert.rejects(
      runtime.query("SELECT password_hash FROM users"),
      /permission denied/,
    );
    await assert.rejects(
      identity.query("SELECT * FROM courses"),
      /permission denied/,
    );
    await assert.rejects(
      runtime.transaction(async (q) => {
        await q.query("RESET ROLE");
        return q.query("SELECT * FROM users");
      }),
      /permission denied/,
    );
    const r = await inject(restricted.getHttpAdapter().getInstance(), {
      method: "GET",
      url: "/api/v1/courses",
      headers: { cookie: a.cookie, "x-tenant-id": ids.a },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json().every((c: any) => c.tenant_id === ids.a));
  } finally {
    await restricted.close();
    await runtime.close();
    await identity.close();
  }
});

test("balanced proposals distribute sequential feasible work across the available drivers", async () => {
  const rs = await resources();
  for (const dr of rs.drivers)
    await request("POST", "/shifts", a, {
      driver_id: dr.id,
      shift: {
        name: dr.name,
        start_location: "loc-0",
        end_location: "loc-0",
        shift_start: "2026-11-08T06:00:00+01:00",
        shift_end: "2026-11-08T19:00:00+01:00",
        breaks: [],
      },
    });
  for (const hour of ["08", "10", "14", "16"])
    await newCourse({
      pickup_at: `2026-11-08T${hour}:00:00+01:00`,
      appointment_at: `2026-11-08T${String(Number(hour) + 1).padStart(2, "0")}:00:00+01:00`,
    });
  const proposal = await request("POST", "/plans/propose", a, {
    date: "2026-11-08",
  });
  assert.equal(proposal.status, 201, JSON.stringify(proposal.body));
  assert.equal(proposal.body.assigned.length, 4);
  const counts = new Map<string, number>();
  for (const row of proposal.body.assigned)
    counts.set(row.driver_id, (counts.get(row.driver_id) || 0) + 1);
  assert.deepEqual([...counts.values()].sort(), [2, 2]);
});

test("published network responses and authorized course responses match their strict privacy contracts", async () => {
  const { offerOutput, courseOutput } = await import(
    "../packages/contracts/extended.js"
  );
  for (const dto of (await request("GET", "/offers", b)).body)
    offerOutput.parse(dto);
  for (const dto of (await request("GET", "/courses", a)).body)
    courseOutput.parse(dto);
});

test("TOTP matches RFC 6238 and refuses reused or malformed codes", async () => {
  const { totp, checkTotp } = await import("../apps/api/src/mfa.js");
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(totp(secret, 1), "287082");
  assert.equal(checkTotp(secret, "287082", null, 59000), 1);
  assert.equal(checkTotp(secret, "287082", 1, 59000), null);
  assert.equal(checkTotp(secret, "123", null, 59000), null);
});
test("encrypted MFA enrollment requires a valid code and supports one-use recovery with session revocation", async () => {
  const registered = await request("POST", "/auth/register", undefined, {
    email: "mfa-test@fiction.example",
    password,
    company: "Double facteur Démo",
  });
  assert.equal(registered.status, 201);
  const account = {
    cookie: String(registered.headers["set-cookie"]).split(";")[0],
    csrf: registered.body.csrf,
    tenant: registered.body.tenant_id,
    id: "",
  };
  const me = (await request("GET", "/auth/me", account)).body;
  assert.equal(me.mfa_available, true);
  account.id = me.id;
  const enrollment = await request("POST", "/auth/mfa/enroll", account, {
    password,
  });
  assert.equal(enrollment.status, 200, JSON.stringify(enrollment.body));
  const secret = enrollment.body.secret;
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const stored = (
    await db.query("SELECT mfa_pending FROM users WHERE id=$1", [me.id])
  ).rows[0];
  assert.notEqual(stored.mfa_pending, secret);
  const { totp } = await import("../apps/api/src/mfa.js");
  const counter = Math.floor(Date.now() / 30000);
  const confirmed = await request("POST", "/auth/mfa/confirm", account, {
    code: totp(secret, counter),
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.recovery_codes.length, 8);
  assert.equal(
    (
      await request("POST", "/auth/login", undefined, {
        email: "mfa-test@fiction.example",
        password,
      })
    ).body.code,
    "MFA_REQUIRED",
  );
  const logged = await request("POST", "/auth/login", undefined, {
    email: "mfa-test@fiction.example",
    password,
    mfa_code: totp(secret, counter + 1),
  });
  assert.equal(logged.status, 200, JSON.stringify(logged.body));
  assert.equal(
    (
      await request("POST", "/auth/login", undefined, {
        email: "mfa-test@fiction.example",
        password,
        mfa_code: totp(secret, counter + 1),
      })
    ).body.code,
    "MFA_INVALID",
  );
  const rescue = confirmed.body.recovery_codes[0];
  assert.equal(
    (
      await request("POST", "/auth/login", undefined, {
        email: "mfa-test@fiction.example",
        password,
        recovery_code: rescue,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("POST", "/auth/login", undefined, {
        email: "mfa-test@fiction.example",
        password,
        recovery_code: rescue,
      })
    ).body.code,
    "MFA_INVALID",
  );
  assert.equal(
    (
      await request("POST", "/auth/mfa/disable", account, {
        password,
        recovery_code: confirmed.body.recovery_codes[1],
      })
    ).status,
    200,
  );
  assert.equal((await request("GET", "/auth/me", account)).status, 401);
});
test("authentication rate limiting rejects repeated guesses", async () => {
  const limited = await createApp(
    db,
    { demo: true, authLimit: 2 },
    asRole(db, "taxilink_identity"),
  );
  try {
    const send = () =>
      inject(limited.getHttpAdapter().getInstance(), {
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "nobody@fiction.example", password: "wrong" },
      });
    assert.equal((await send()).statusCode, 401);
    assert.equal((await send()).statusCode, 401);
    assert.equal((await send()).statusCode, 429);
  } finally {
    await limited.close();
  }
});

async function accountFixture(requireVerifiedEmail = false) {
  const { deliverAccountMail } = await import("../apps/api/src/mail.js");
  await db.query("DELETE FROM account_links");
  const sent: { to: string; subject: string; text: string }[] = [];
  let failDelivery = false;
  const mail = {
    key: "22".repeat(32),
    origin: "http://localhost:3000",
    send: async (message: any) => {
      if (failDelivery) throw new Error("Synthetic delivery outage");
      sent.push(message);
    },
  };
  const identity = asRole(db, "taxilink_identity");
  const service = await createApp(
    db,
    {
      demo: true,
      mfaKey: "11".repeat(32),
      authLimit: 100,
      mail,
      requireVerifiedEmail,
    },
    identity,
  );
  let cookie = "",
    csrf = "",
    tenant = "";
  async function call(path: string, body?: any, authenticated = true) {
    const result = await inject(service.getHttpAdapter().getInstance(), {
      method: body === undefined ? "GET" : "POST",
      url: "/api/v1" + path,
      headers: {
        "content-type": "application/json",
        ...(authenticated
          ? { cookie, "x-csrf-token": csrf, "x-tenant-id": tenant }
          : {}),
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    return {
      status: result.statusCode,
      body: result.json(),
      headers: result.headers,
    };
  }
  const email = `recovery-${randomUUID()}@example.test`;
  const created = await call(
    "/auth/register",
    { email, password, company: "Fictive recovery test" },
    false,
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  cookie = String(created.headers["set-cookie"]).split(";")[0];
  csrf = created.body.csrf;
  tenant = created.body.tenant_id;
  return {
    service,
    call,
    email,
    sent,
    identity,
    mail,
    drain: async () => {
      for (
        let i = 0;
        i < 10 && (await deliverAccountMail(identity, mail));
        i++
      );
    },
    setFailure: (v: boolean) => {
      failDelivery = v;
    },
  };
}
function linkToken(messages: { text: string }[], purpose: string) {
  const message = messages.find((m) => m.text.includes(`#${purpose}=`));
  assert.ok(message);
  return message.text.match(new RegExp(`#${purpose}=([a-f0-9]{64})`))![1];
}

test("email verification enforces the optional access policy, authenticates ownership once and keeps the queue encrypted", async () => {
  const f = await accountFixture(true);
  try {
    const me = await f.call("/auth/me");
    assert.equal(me.body.email_verified, false);
    assert.equal(me.body.email_available, true);
    assert.equal(
      (await f.call("/courses")).body.code,
      "EMAIL_VERIFICATION_REQUIRED",
    );
    assert.equal((await f.call("/auth/email/request", {}, false)).status, 401);
    assert.equal((await f.call("/auth/email/request", {})).status, 200);
    assert.equal(
      (await db.query("SELECT * FROM account_links")).rows.length,
      1,
    );
    await f.drain();
    const raw = linkToken(f.sent, "verify");
    const links = (await db.query("SELECT * FROM account_links")).rows;
    assert.ok(!JSON.stringify(links).includes(raw));
    assert.equal(
      (await db.query("SELECT encrypted_payload FROM account_mail")).rows[0]
        .encrypted_payload,
      "",
    );
    assert.equal(
      (await f.call("/auth/email/verify", { token: raw }, false)).status,
      200,
    );
    assert.equal(
      (await f.call("/auth/email/verify", { token: raw }, false)).body.code,
      "ACCOUNT_LINK_INVALID",
    );
    assert.equal((await f.call("/auth/me")).body.email_verified, true);
    assert.equal((await f.call("/courses")).status, 200);
  } finally {
    await f.service.close();
  }
});

test("password requests never disclose accounts, are throttled by recipient and store no raw links", async () => {
  const f = await accountFixture();
  try {
    const missing = await f.call(
      "/auth/password/request",
      { email: "missing@example.test" },
      false,
    );
    const known = await f.call(
      "/auth/password/request",
      { email: f.email },
      false,
    );
    assert.equal(missing.status, known.status);
    assert.deepEqual(missing.body, known.body);
    const queued = (await db.query("SELECT * FROM account_mail")).rows;
    assert.equal(queued.length, 2);
    assert.ok(!JSON.stringify(queued).includes(f.email));
    await f.call("/auth/password/request", { email: f.email }, false);
    assert.equal((await db.query("SELECT * FROM account_mail")).rows.length, 2);
    await assert.rejects(
      asRole(db, "taxilink_app").query("SELECT * FROM account_links"),
      /permission denied/,
    );
    await assert.rejects(
      asRole(db, "taxilink_app").query("SELECT * FROM account_mail"),
      /permission denied/,
    );
    await f.drain();
    const raw = linkToken(f.sent, "reset");
    assert.ok(
      !JSON.stringify(
        (await db.query("SELECT * FROM account_links")).rows,
      ).includes(raw),
    );
    assert.equal(
      (
        await f.call(
          "/auth/password/reset",
          { token: raw, password: "too-short" },
          false,
        )
      ).status,
      400,
    );
    const changed = await Promise.all(
      [0, 1].map(() =>
        f.call(
          "/auth/password/reset",
          { token: raw, password: "Replacement-synthetic-password-2026" },
          false,
        ),
      ),
    );
    assert.deepEqual(changed.map((r) => r.status).sort(), [200, 400]);
    assert.equal((await f.call("/auth/me")).status, 401);
    assert.equal(
      (await f.call("/auth/login", { email: f.email, password }, false)).status,
      401,
    );
    assert.equal(
      (
        await f.call(
          "/auth/login",
          { email: f.email, password: "Replacement-synthetic-password-2026" },
          false,
        )
      ).status,
      200,
    );
  } finally {
    await f.service.close();
  }
});

test("expired and replaced recovery links are refused and mail delivery retries without exposing payloads", async () => {
  const f = await accountFixture();
  try {
    await f.call("/auth/password/request", { email: f.email }, false);
    await f.drain();
    const old = linkToken(f.sent, "reset");
    await db.query(
      "UPDATE account_links SET expires_at=now()-interval '1 minute',created_at=now()-interval '2 minutes' WHERE purpose='reset'",
    );
    assert.equal(
      (
        await f.call(
          "/auth/password/reset",
          { token: old, password: "Replacement-synthetic-password-2026" },
          false,
        )
      ).body.code,
      "ACCOUNT_LINK_INVALID",
    );
    await f.call("/auth/password/request", { email: f.email }, false);
    assert.equal(
      (
        await f.call(
          "/auth/password/reset",
          { token: old, password: "Replacement-synthetic-password-2026" },
          false,
        )
      ).status,
      400,
    );
    f.setFailure(true);
    await f.drain();
    const pending = (
      await db.query("SELECT * FROM account_mail WHERE sent_at IS NULL")
    ).rows;
    assert.equal(pending[0].attempts, 1);
    assert.ok(pending[0].encrypted_payload.length > 100);
    await db.query(
      "UPDATE account_mail SET next_attempt=now() WHERE sent_at IS NULL",
    );
    f.setFailure(false);
    await f.drain();
    assert.equal(f.sent.filter((m) => m.text.includes("#reset=")).length, 2);
  } finally {
    await f.service.close();
  }
});

test("recovery cannot bypass MFA and consumes a single-use factor while revoking sessions", async () => {
  const f = await accountFixture();
  try {
    const { encryptSecret, newSecret, recoveryCodes } = await import(
      "../apps/api/src/mfa.js"
    );
    const recovery = recoveryCodes();
    const { hash } = await import("../apps/api/src/security.js");
    const user = (
      await db.query("SELECT id FROM users WHERE email=$1", [f.email])
    ).rows[0];
    await db.query(
      "UPDATE users SET mfa_secret=$1,recovery_hashes=$2 WHERE id=$3",
      [
        encryptSecret(newSecret(), "11".repeat(32)),
        JSON.stringify(recovery.map((code) => hash(code.replace(/-/g, "")))),
        user.id,
      ],
    );
    await f.call("/auth/password/request", { email: f.email }, false);
    await f.drain();
    const raw = linkToken(f.sent, "reset"),
      body = { token: raw, password: "Recovered-synthetic-password-2026" };
    assert.equal(
      (await f.call("/auth/password/reset", body, false)).body.code,
      "MFA_REQUIRED",
    );
    assert.equal(
      (
        await f.call(
          "/auth/password/reset",
          { ...body, recovery_code: "FFFFFFFF-FFFFFFFF" },
          false,
        )
      ).body.code,
      "MFA_INVALID",
    );
    assert.equal(
      (
        await f.call(
          "/auth/password/reset",
          { ...body, recovery_code: recovery[0] },
          false,
        )
      ).status,
      200,
    );
    assert.equal((await f.call("/auth/me")).status, 401);
    const after = (
      await db.query(
        "SELECT mfa_secret,recovery_hashes FROM users WHERE id=$1",
        [user.id],
      )
    ).rows[0];
    assert.ok(after.mfa_secret);
    assert.equal(after.recovery_hashes.length, 7);
  } finally {
    await f.service.close();
  }
});

async function pilotFixture(options: any = {}) {
  const service = await createApp(
    db,
    { demo: true, authLimit: 1000, ...options },
    asRole(db, "taxilink_identity"),
  );
  let cookie = "",
    csrf = "",
    tenant = "";
  async function call(path: string, body?: any) {
    const r = await inject(service.getHttpAdapter().getInstance(), {
      method: body === undefined ? "GET" : "POST",
      url: "/api/v1" + path,
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrf,
        "x-tenant-id": tenant,
        "idempotency-key": randomUUID(),
      },
      ...(body === undefined ? {} : { payload: body }),
    });
    return { status: r.statusCode, body: r.json(), headers: r.headers };
  }
  const created = await call("/auth/register", {
    email: `pilot-${randomUUID()}@example.test`,
    password,
    company: "Fictive pilot",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  cookie = String(created.headers["set-cookie"]).split(";")[0];
  csrf = created.body.csrf;
  tenant = created.body.tenant_id;
  const me = (await call("/auth/me")).body;
  async function driverAt(location = "loc-0", name = "Fictive pilot driver") {
    const r = await call("/drivers", {
      name,
      shift_start: "2026-11-04T06:00:00+01:00",
      shift_end: "2026-11-04T20:00:00+01:00",
      start_location: location,
      end_location: location,
      breaks: [],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id as string;
  }
  async function vehicleAt(location = "loc-0") {
    const r = await call("/vehicles", {
      label: "Fictive pilot vehicle",
      seats: 4,
      accessible: true,
      start_location: location,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id as string;
  }
  async function job(extra: any = {}) {
    const r = await call("/courses", course(extra));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id as string;
  }
  return { service, call, tenant, user: me.id, driverAt, vehicleAt, job };
}
const mockRouting = {
  name: "test-routed-fixture",
  matrix: async (points: any[]) =>
    points.map((_, i) =>
      points.map((_, j) => ({
        minutes: i === j ? 0 : 20,
        distance_m: i === j ? 0 : 10000,
      })),
    ),
};
async function privateLocation(
  f: Awaited<ReturnType<typeof pilotFixture>>,
  label: string,
) {
  const r = await f.call("/locations", {
    label,
    address: "ADRESSE FICTIVE PRIVÉE " + label,
    sector: "Secteur fictif 75",
    latitude: 48.86,
    longitude: 2.35,
    confirmed: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

test("private locations, routed matrices and marketplace sectors preserve address isolation until confirmation", async () => {
  const a = await pilotFixture({ routing: mockRouting }),
    b = await pilotFixture({ routing: mockRouting });
  try {
    const origin = await privateLocation(a, "Origine"),
      destination = await privateLocation(a, "Destination"),
      depot = await privateLocation(b, "Dépôt");
    const own = (await b.call("/locations")).body;
    assert.ok(!own.some((p: any) => p.id === origin));
    assert.equal(
      (await b.call("/courses", course({ origin, destination }))).body.code,
      "LOCATION_DENIED",
    );
    assert.equal(
      (
        await a.call("/routing/refresh", {
          location_ids: [origin, destination],
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await b.call("/routing/refresh", {
          location_ids: [origin, destination],
        })
      ).status,
      404,
    );
    const gid = (await a.call("/groups", { name: "Fictive routing network" }))
      .body.id;
    await a.call(`/groups/${gid}/invite`, { tenant_id: b.tenant });
    const invitation = (await b.call("/network-invitations")).body[0];
    await b.call(`/network-invitations/${invitation.id}/accept`, {});
    const cid = await a.job({ origin, destination }),
      offered = await a.call("/offers", {
        course_id: cid,
        group_id: gid,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    assert.equal(offered.status, 201, JSON.stringify(offered.body));
    const dto = (await b.call("/offers")).body.find(
      (o: any) => o.id === offered.body.id,
    );
    assert.equal(dto.origin_label, "Secteur fictif 75");
    assert.ok(!JSON.stringify(dto).includes("ADRESSE"));
    const driver = await b.driverAt(depot),
      vehicle = await b.vehicleAt(depot);
    const claimed = await b.call(`/offers/${offered.body.id}/claim`, {
      driver_id: driver,
      vehicle_id: vehicle,
    });
    assert.equal(claimed.status, 201, JSON.stringify(claimed.body));
    assert.ok(
      !(await b.call("/locations")).body.some((p: any) => p.id === origin),
    );
    assert.equal(
      (
        await a.call(`/offers/${offered.body.id}/decision`, {
          decision: "approve",
        })
      ).status,
      201,
    );
    assert.ok(
      (await b.call("/locations")).body.some((p: any) => p.id === origin),
    );
  } finally {
    await a.service.close();
    await b.service.close();
  }
});

test("driver leave and vehicle maintenance block assignments, require acknowledgment for commitments and cancel explicitly", async () => {
  const f = await pilotFixture();
  try {
    const did = await f.driverAt(),
      vid = await f.vehicleAt(),
      cid = await f.job();
    const absent = await f.call("/absences", {
      driver_id: did,
      start_at: "2026-11-04T08:00:00+01:00",
      end_at: "2026-11-04T11:00:00+01:00",
      reason: "leave",
    });
    assert.equal(absent.status, 201, JSON.stringify(absent.body));
    assert.equal(
      (
        await f.call(`/courses/${cid}/assign`, {
          driver_id: did,
          vehicle_id: vid,
          version: 1,
        })
      ).body.code,
      "RESOURCE_UNAVAILABLE",
    );
    await f.call(`/absences/${absent.body.id}/cancel`, {});
    assert.equal(
      (
        await f.call(`/courses/${cid}/assign`, {
          driver_id: did,
          vehicle_id: vid,
          version: 1,
        })
      ).status,
      201,
    );
    const payload = {
      vehicle_id: vid,
      start_at: "2026-11-04T08:00:00+01:00",
      end_at: "2026-11-04T11:00:00+01:00",
      reason: "maintenance",
    };
    assert.equal(
      (await f.call("/absences", payload)).body.code,
      "RESOURCE_COMMITTED",
    );
    assert.equal(
      (await f.call("/absences", { ...payload, acknowledge_conflicts: true }))
        .status,
      201,
    );
    assert.ok(
      (await f.call("/alerts")).body.some(
        (v: any) => v.kind === "resource_unavailable",
      ),
    );
    assert.equal((await f.call(`/courses/${cid}`)).body.driver_id, did);
  } finally {
    await f.service.close();
  }
});

test("transfer approval is atomic, leaves the old assignment after rejection or infeasibility and freezes started missions", async () => {
  const f = await pilotFixture();
  try {
    const did = await f.driverAt(),
      vid = await f.vehicleAt(),
      replacement = await f.driverAt(),
      replacementVehicle = await f.vehicleAt(),
      cid = await f.job();
    await f.call(`/courses/${cid}/assign`, {
      driver_id: did,
      vehicle_id: vid,
      version: 1,
    });
    const request = (
      await f.call(`/courses/${cid}/transfer-request`, {
        version: 2,
        reason: "breakdown",
      })
    ).body;
    assert.equal((await f.call(`/courses/${cid}`)).body.driver_id, did);
    assert.equal(
      (
        await f.call(`/transfers/${request.id}/decision`, {
          decision: "approve",
          driver_id: replacement,
          vehicle_id: vid,
        })
      ).status,
      201,
    );
    const updated = (await f.call(`/courses/${cid}`)).body;
    assert.equal(updated.driver_id, replacement);
    assert.equal(
      (
        await f.call(`/transfers/${request.id}/decision`, {
          decision: "reject",
        })
      ).status,
      409,
    );
    const second = (
      await f.call(`/courses/${cid}/transfer-request`, {
        version: updated.version,
        reason: "other",
      })
    ).body;
    await f.call("/absences", {
      driver_id: did,
      start_at: "2026-11-04T06:00:00+01:00",
      end_at: "2026-11-04T20:00:00+01:00",
      reason: "leave",
    });
    assert.equal(
      (
        await f.call(`/transfers/${second.id}/decision`, {
          decision: "approve",
          driver_id: did,
          vehicle_id: replacementVehicle,
        })
      ).body.code,
      "RESOURCE_UNAVAILABLE",
    );
    assert.equal((await f.call(`/courses/${cid}`)).body.driver_id, replacement);
    await f.call(`/transfers/${second.id}/decision`, { decision: "reject" });
    await f.call(`/courses/${cid}/status`, {
      status: "approaching",
      version: updated.version,
    });
    assert.equal(
      (
        await f.call(`/courses/${cid}/transfer-request`, {
          version: updated.version + 1,
          reason: "delay",
        })
      ).body.code,
      "COURSE_FROZEN",
    );
  } finally {
    await f.service.close();
  }
});

test("draft activation, priorities, pickup windows, confirmation and no-show have explicit authorized transitions", async () => {
  const f = await pilotFixture();
  try {
    const cid = await f.job({
        draft: true,
        priority: 3,
        pickup_latest: "2026-11-04T09:10:00+01:00",
        operational_notes: "Entrée fictive B",
        request_origin: "facility",
      }),
      did = await f.driverAt(),
      vid = await f.vehicleAt();
    assert.equal(
      (
        await f.call(`/courses/${cid}/assign`, {
          driver_id: did,
          vehicle_id: vid,
          version: 1,
        })
      ).status,
      409,
    );
    await f.call(`/courses/${cid}/activate`, { version: 1 });
    await f.call(`/courses/${cid}/assign`, {
      driver_id: did,
      vehicle_id: vid,
      version: 2,
    });
    assert.equal(
      (
        await f.call(`/courses/${cid}/status`, {
          status: "confirmed",
          version: 3,
        })
      ).status,
      201,
    );
    await f.call(`/courses/${cid}/status`, {
      status: "approaching",
      version: 4,
    });
    assert.equal(
      (
        await f.call(`/courses/${cid}/status`, {
          status: "no_show",
          version: 5,
        })
      ).status,
      201,
    );
    const actual = (await f.call(`/courses/${cid}`)).body;
    assert.equal(actual.priority, 3);
    assert.equal(actual.status, "no_show");
    assert.equal(actual.operational_notes, "Entrée fictive B");
  } finally {
    await f.service.close();
  }
});

test("time-window optimizer proposes without mutation, applies atomically and keeps begun missions frozen", async () => {
  const f = await pilotFixture();
  try {
    const did = await f.driverAt(),
      vid = await f.vehicleAt();
    await f.driverAt();
    await f.vehicleAt();
    const old = await f.job({
      pickup_at: "2026-11-04T08:00:00+01:00",
      appointment_at: "2026-11-04T09:00:00+01:00",
    });
    await f.call(`/courses/${old}/assign`, {
      driver_id: did,
      vehicle_id: vid,
      version: 1,
    });
    await f.call(`/courses/${old}/status`, {
      status: "approaching",
      version: 2,
    });
    await f.job({
      pickup_at: "2026-11-04T10:00:00+01:00",
      appointment_at: "2026-11-04T11:00:00+01:00",
      priority: 2,
    });
    const plan = await f.call("/plans/propose", {
      date: "2026-11-04",
      strategy: "search",
      replan: true,
      max_seconds: 2,
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    assert.equal(plan.body.algorithm, "time-window-search-v1");
    assert.ok(!plan.body.assigned.some((v: any) => v.course_id === old));
    assert.equal(
      (await f.call("/courses")).body.filter(
        (v: any) => v.status === "unassigned",
      ).length,
      1,
    );
    const applied = await f.call(`/plans/${plan.body.id}/apply`, {});
    assert.equal(applied.status, 201, JSON.stringify(applied.body));
    assert.equal((await f.call(`/courses/${old}`)).body.status, "approaching");
    assert.equal(
      (await f.call(`/plans/${plan.body.id}/apply`, {})).status,
      409,
    );
  } finally {
    await f.service.close();
  }
});

test("push devices are private, delivery retries and revoked devices cannot receive queued events", async () => {
  const { deliverNotification } = await import("../apps/api/src/deliveries.js");
  const key = "ab".repeat(32);
  let calls = 0;
  const push = {
    send: async () => {
      calls++;
      if (calls === 1) throw new Error("temporary");
      return { ticket: "synthetic-ticket" };
    },
    receipt: async () => "ok" as const,
  };
  const f = await pilotFixture({ push, deliveryKey: key });
  const other = await pilotFixture({ push, deliveryKey: key });
  try {
    const token = `ExpoPushToken[synthetic_${randomUUID().replaceAll("-", "")}]`;
    const registered = await f.call("/devices", { token, platform: "android" });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    assert.equal(
      (await other.call("/devices", { token, platform: "android" })).status,
      403,
    );
    assert.deepEqual(
      (await other.call("/notification-settings")).body.devices,
      [],
    );
    const settings = (await f.call("/notification-settings")).body;
    assert.equal(settings.devices.length, 1);
    assert.ok(!JSON.stringify(settings).includes(token));
    const notification = randomUUID();
    await db.query(
      "INSERT INTO notifications(id,tenant_id,user_id,kind,object_id) VALUES($1,$2,$3,'test.synthetic',$4)",
      [notification, f.tenant, f.user, randomUUID()],
    );
    const identity = asRole(db, "taxilink_identity");
    await deliverNotification(identity, { push, key });
    let job = (
      await db.query(
        "SELECT * FROM notification_deliveries WHERE notification_id=$1",
        [notification],
      )
    ).rows[0];
    assert.equal(job.attempts, 1);
    assert.equal(job.status, "pending");
    await db.query(
      "UPDATE notification_deliveries SET next_attempt=now()-interval '1 minute' WHERE id=$1",
      [job.id],
    );
    await deliverNotification(identity, { push, key });
    job = (
      await db.query("SELECT * FROM notification_deliveries WHERE id=$1", [
        job.id,
      ])
    ).rows[0];
    assert.equal(job.status, "receipt");
    await db.query(
      "UPDATE notification_deliveries SET next_attempt=now()-interval '1 minute' WHERE id=$1",
      [job.id],
    );
    await deliverNotification(identity, { push, key });
    assert.equal(
      (
        await db.query(
          "SELECT status FROM notification_deliveries WHERE id=$1",
          [job.id],
        )
      ).rows[0].status,
      "sent",
    );
    await other.call(`/devices/${registered.body.id}/remove`, {});
    assert.equal(
      (await f.call("/notification-settings")).body.devices.length,
      1,
    );
    await db.query(
      "INSERT INTO notifications(id,tenant_id,user_id,kind,object_id) VALUES($1,$2,$3,'test.synthetic',$4)",
      [randomUUID(), f.tenant, f.user, randomUUID()],
    );
    await f.call(`/devices/${registered.body.id}/remove`, {});
    assert.equal(await deliverNotification(identity, { push, key }), false);
    assert.equal(
      (await f.call("/notification-settings")).body.devices.length,
      0,
    );
    assert.equal(calls, 2);
  } finally {
    await f.service.close();
    await other.service.close();
  }
});

test("address search validates dedicated input before calling the provider and requires a managing role", async () => {
  const queries: any[] = [];
  const f = await pilotFixture({
    geocoding: {
      search: async (query: string, kind: string) => {
        queries.push({ query, kind });
        return [];
      },
    },
  });
  try {
    assert.equal(
      (
        await f.call("/addresses/search", {
          query: "Place Toulouse",
          kind: "address",
          patient_name: "Fictif",
        })
      ).status,
      400,
    );
    assert.equal(queries.length, 0);
    assert.equal(
      (
        await f.call("/addresses/search", {
          query: "Place Toulouse",
          kind: "address",
        })
      ).status,
      201,
    );
    assert.deepEqual(queries, [{ query: "Place Toulouse", kind: "address" }]);
    for (const role of ["viewer", "driver"]) {
      await db.query(
        "UPDATE memberships SET role=$1 WHERE tenant_id=$2 AND user_id=$3",
        [role, f.tenant, f.user],
      );
      assert.equal(
        (
          await f.call("/addresses/search", {
            query: "Place Toulouse",
            kind: "address",
          })
        ).status,
        403,
      );
    }
    assert.equal(queries.length, 1);
  } finally {
    await f.service.close();
  }
});

test("private location directories exclude unassigned driver and viewer access", async () => {
  const f = await pilotFixture();
  try {
    const id = await privateLocation(f, "Entrée privée fictive");
    assert.ok((await f.call("/locations")).body.some((v: any) => v.id === id));
    for (const role of ["viewer", "driver"]) {
      await db.query(
        "UPDATE memberships SET role=$1 WHERE tenant_id=$2 AND user_id=$3",
        [role, f.tenant, f.user],
      );
      const list = await f.call("/locations");
      assert.equal(list.status, 200);
      assert.ok(!list.body.some((v: any) => v.id === id));
    }
  } finally {
    await f.service.close();
  }
});

test("a vehicle departure point can be updated to an owned location but never a foreign location", async () => {
  const f = await pilotFixture(),
    other = await pilotFixture();
  try {
    const id = await f.vehicleAt(),
      own = await privateLocation(f, "Dépôt propre fictif"),
      foreign = await privateLocation(other, "Dépôt étranger fictif");
    const body = {
      label: "Véhicule de test",
      seats: 4,
      accessible: false,
      active: true,
      start_location: own,
    };
    assert.equal((await f.call(`/vehicles/${id}/update`, body)).status, 201);
    assert.equal(
      (await f.call("/vehicles")).body.find((v: any) => v.id === id)
        .start_location,
      own,
    );
    assert.equal(
      (
        await f.call(`/vehicles/${id}/update`, {
          ...body,
          start_location: foreign,
        })
      ).status,
      404,
    );
    assert.equal(
      (await f.call("/vehicles")).body.find((v: any) => v.id === id)
        .start_location,
      own,
    );
  } finally {
    await f.service.close();
    await other.service.close();
  }
});
