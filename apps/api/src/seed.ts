import { randomUUID } from "node:crypto";
import { connect, migrate, type Database } from "./db";
import { passwordHash } from "./security";
export const ids = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  group: "33333333-3333-4333-8333-333333333333",
};
export async function seed(
  db: Database,
  password: string,
  date = "2026-11-04",
) {
  if (password.length < 16)
    throw new Error("DEMO_PASSWORD must have at least 16 characters");
  await db.transaction(async (q) => {
    if (
      (await q.query("SELECT 1 FROM tenants WHERE id=$1", [ids.a])).rows.length
    )
      return;
    for (const [id, name] of [
      [ids.a, "Atlas Démo"],
      [ids.b, "Horizon Démo"],
    ])
      await q.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [id, name]);
    const names = [
      "Dépôt démo",
      "Gare démo",
      "Centre démo",
      "Clinique fictive",
    ];
    for (let i = 0; i < 4; i++)
      await q.query("INSERT INTO locations VALUES($1,$2)", [
        `loc-${i}`,
        names[i],
      ]);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        await q.query(
          "INSERT INTO routes VALUES($1,$2,$3,'synthetic-fixture',now()+interval '365 days')",
          [`loc-${i}`, `loc-${j}`, i === j ? 0 : 20],
        );
    for (const [tenant, prefix] of [
      [ids.a, "atlas"],
      [ids.b, "horizon"],
    ]) {
      for (const role of ["admin", "dispatcher", "driver", "viewer"]) {
        const uid = randomUUID();
        await q.query("INSERT INTO users VALUES($1,$2,$3)", [
          uid,
          `${role}@${prefix}.example`,
          passwordHash(password),
        ]);
        await q.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
          [tenant, uid, role],
        );
        if (role === "driver")
          for (let i = 0; i < 2; i++)
            await q.query(
              "INSERT INTO drivers(id,tenant_id,user_id,name,shift_start,shift_end,start_location,end_location,breaks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                randomUUID(),
                tenant,
                i === 0 ? uid : null,
                `${prefix === "atlas" ? "Camille" : "Alex"} ${i + 1}`,
                `${date}T06:00:00+01:00`,
                `${date}T19:00:00+01:00`,
                "loc-0",
                "loc-0",
                JSON.stringify([
                  {
                    start: `${date}T12:00:00+01:00`,
                    end: `${date}T12:30:00+01:00`,
                  },
                ]),
              ],
            );
      }
      for (let i = 0; i < 2; i++)
        await q.query(
          "INSERT INTO vehicles(id,tenant_id,label,seats,accessible) VALUES($1,$2,$3,$4,$5)",
          [randomUUID(), tenant, `Véhicule démo ${i + 1}`, 4, i === 1],
        );
      for (let i = 0; i < 4; i++)
        await q.query(
          "INSERT INTO courses(id,tenant_id,reference,origin,destination,pickup_at,appointment_at,arrival_buffer,passengers) VALUES($1,$2,$3,$4,$5,$6,$7,15,1)",
          [
            randomUUID(),
            tenant,
            `DEMO-${prefix.toUpperCase()}-${i + 1}`,
            "loc-1",
            "loc-3",
            `${date}T${String(8 + i * 2).padStart(2, "0")}:00:00+01:00`,
            `${date}T${String(9 + i * 2).padStart(2, "0")}:00:00+01:00`,
          ],
        );
    }
    await q.query("INSERT INTO partner_groups VALUES($1,$2,$3)", [
      ids.group,
      ids.a,
      "Réseau démo partagé",
    ]);
    for (const tenant of [ids.a, ids.b])
      await q.query("INSERT INTO group_members VALUES($1,$2)", [
        ids.group,
        tenant,
      ]);
  });
}
if (process.argv[1]?.endsWith("/seed.ts")) {
  (async () => {
    if (process.env.DEMO_MODE !== "true")
      throw new Error("DEMO_MODE=true required");
    const db = await connect(process.env.DATABASE_URL);
    try {
      await migrate(db);
      await seed(
        db,
        process.env.DEMO_PASSWORD || "",
        process.env.DEMO_DATE || "2026-11-04",
      );
      console.log(
        "Synthetic fixtures ready. See README for account emails. Existing fixtures are left unchanged.",
      );
    } finally {
      await db.close();
    }
  })().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
