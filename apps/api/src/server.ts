import "reflect-metadata";
import { All, Controller, Module, Req, Res } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Sql, Row } from "./db";
import {
  Fault,
  hash,
  passwordHash,
  requireThat,
  token,
  verifyPassword,
} from "./security";
import { validateAssignment } from "./planning";
import * as input from "../../../packages/contracts";
export interface Options {
  demo: boolean;
  webOrigin?: string;
  secureCookies?: boolean;
}
const dummyPassword = passwordHash("dummy-password-never-accepted");
export async function createApp(db: Database, options: Options) {
  const limits = new Map<string, { count: number; until: number }>();
  async function audit(
    q: Sql,
    tenant: string,
    user: string,
    action: string,
    id: string,
  ) {
    await q.query(
      "INSERT INTO audit_events(id,tenant_id,actor_id,action,object_id) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), tenant, user, action, id],
    );
  }
  function limited(req: Request) {
    const k = req.ip || "unknown";
    const now = Date.now();
    let v = limits.get(k);
    if (!v || v.until < now) {
      v = { count: 0, until: now + 60000 };
      limits.set(k, v);
    }
    requireThat(++v.count <= 15, 429, "RATE_LIMITED");
    if (limits.size > 10000)
      for (const [id, v] of limits) if (v.until < now) limits.delete(id);
  }
  function cookie(req: Request) {
    return (
      req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("tl_session="))
        ?.slice(11) || ""
    );
  }
  function setCookie(res: Response, value: string, maxAge: number) {
    res.setHeader(
      "Set-Cookie",
      `tl_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${options.secureCookies ? "; Secure" : ""}`,
    );
  }
  async function session(q: Sql, req: Request) {
    const s = (
      await q.query(
        "SELECT s.user_id,s.csrf,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
        [hash(cookie(req))],
      )
    ).rows[0];
    requireThat(s, 401, "SESSION_REQUIRED");
    return s;
  }
  async function issueSession(q: Sql, user: string) {
    const raw = token(),
      csrf = token();
    await q.query(
      "INSERT INTO sessions VALUES($1,$2,$3,now()+interval '8 hours')",
      [hash(raw), user, csrf],
    );
    return { raw, csrf };
  }
  async function handle(req: Request, res: Response) {
    const path = req.path.replace(/^\/api\/v1/, "") || "/";
    const write = !["GET", "HEAD"].includes(req.method);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (write) {
      requireThat(
        !req.headers.origin ||
          req.headers.origin === (options.webOrigin || "http://localhost:3000"),
        403,
        "ORIGIN_DENIED",
      );
      requireThat(req.is("application/json"), 415, "JSON_REQUIRED");
    }
    if (req.method === "GET" && path === "/health")
      return res.json({ status: "ok", demo: options.demo, documents: false });
    if (
      req.method === "POST" &&
      (path === "/auth/register" || path === "/auth/login")
    ) {
      limited(req);
      if (path === "/auth/register") {
        requireThat(options.demo, 403, "REGISTRATION_DISABLED");
        const data = input.registerInput.parse(req.body);
        const user = randomUUID(),
          tenant = randomUUID();
        const result = await db.transaction(async (q) => {
          requireThat(
            !(
              await q.query("SELECT 1 FROM users WHERE email=$1", [
                data.email.toLowerCase(),
              ])
            ).rows.length,
            409,
            "ACCOUNT_EXISTS",
          );
          await q.query("INSERT INTO users VALUES($1,$2,$3)", [
            user,
            data.email.toLowerCase(),
            passwordHash(data.password),
          ]);
          await q.query("INSERT INTO tenants(id,name) VALUES($1,$2)", [
            tenant,
            data.company,
          ]);
          await q.query(
            "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
            [tenant, user],
          );
          await audit(q, tenant, user, "tenant.created", tenant);
          return issueSession(q, user);
        });
        setCookie(res, result.raw, 8 * 3600);
        return res.status(201).json({ csrf: result.csrf, tenant_id: tenant });
      }
      const data = input.loginInput.parse(req.body);
      const user = (
        await db.query("SELECT * FROM users WHERE email=$1", [
          data.email.toLowerCase(),
        ])
      ).rows[0];
      const valid = verifyPassword(
        data.password,
        user?.password_hash || dummyPassword,
      );
      requireThat(user && valid, 401, "INVALID_CREDENTIALS");
      const result = await db.transaction((q) => issueSession(q, user.id));
      setCookie(res, result.raw, 8 * 3600);
      return res.json({ csrf: result.csrf });
    }
    if (path === "/auth/me" && req.method === "GET") {
      const s = await session(db, req);
      const memberships = (
        await db.query(
          "SELECT m.tenant_id,m.role,t.name FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.active",
          [s.user_id],
        )
      ).rows;
      return res.json({
        id: s.user_id,
        email: s.email,
        csrf: s.csrf,
        memberships,
        demo: options.demo,
      });
    }
    if (path === "/auth/logout" && req.method === "POST") {
      const s = await session(db, req);
      requireThat(req.headers["x-csrf-token"] === s.csrf, 403, "CSRF_DENIED");
      await db.query("DELETE FROM sessions WHERE token_hash=$1", [
        hash(cookie(req)),
      ]);
      setCookie(res, "", 0);
      return res.json({ ok: true });
    }
    if (path === "/invitations/accept" && req.method === "POST") {
      const data = input.acceptInput.parse(req.body);
      const result = await db.transaction(async (q) => {
        const s = await session(q, req);
        requireThat(req.headers["x-csrf-token"] === s.csrf, 403, "CSRF_DENIED");
        const invitation = (
          await q.query(
            "SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE",
            [hash(data.token)],
          )
        ).rows[0];
        requireThat(
          invitation &&
            !invitation.revoked &&
            !invitation.accepted &&
            new Date(invitation.expires_at).getTime() > Date.now() &&
            invitation.email === s.email,
          400,
          "INVITATION_INVALID",
        );
        requireThat(
          !(
            await q.query(
              "SELECT 1 FROM memberships WHERE tenant_id=$1 AND user_id=$2",
              [invitation.tenant_id, s.user_id],
            )
          ).rows.length,
          409,
          "MEMBERSHIP_EXISTS",
        );
        await q.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
          [invitation.tenant_id, s.user_id, invitation.role],
        );
        await q.query("UPDATE invitations SET accepted=true WHERE id=$1", [
          invitation.id,
        ]);
        await audit(
          q,
          invitation.tenant_id,
          s.user_id,
          "invitation.accepted",
          invitation.id,
        );
        return { tenant_id: invitation.tenant_id };
      });
      return res.json(result);
    }
    const tenant = input.uuid.parse(req.headers["x-tenant-id"]);
    const result = await db.transaction(async (q) => {
      const s = await session(q, req);
      const membership = (
        await q.query(
          "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND active FOR SHARE",
          [tenant, s.user_id],
        )
      ).rows[0];
      requireThat(membership, 403, "ACCESS_DENIED");
      const role = membership.role;
      if (write)
        requireThat(req.headers["x-csrf-token"] === s.csrf, 403, "CSRF_DENIED");
      await q.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      await q.query("SET LOCAL ROLE taxilink_app");
      const manage = () =>
        requireThat(
          role === "admin" || role === "dispatcher",
          403,
          "ACCESS_DENIED",
        );
      const admin = () => requireThat(role === "admin", 403, "ACCESS_DENIED");
      if (path.startsWith("/documents"))
        throw new Fault(403, "DOCUMENTS_DISABLED");
      let key: string | undefined;
      let requestHash = "";
      if (write) {
        // One lock orders all planning/resource mutations for this company across API replicas.
        await q.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [
          tenant,
        ]);
        key = z.string().min(8).max(100).parse(req.headers["idempotency-key"]);
        requestHash = hash(`${req.method}:${path}:${JSON.stringify(req.body)}`);
        const old = (
          await q.query(
            "SELECT request_hash,response FROM idempotency WHERE tenant_id=$1 AND actor_id=$2 AND key=$3",
            [tenant, s.user_id, key],
          )
        ).rows[0];
        if (old) {
          requireThat(
            old.request_hash === requestHash,
            409,
            "IDEMPOTENCY_CONFLICT",
          );
          return old.response;
        }
      }
      async function dispatch(): Promise<any> {
        if (req.method === "GET") {
          if (path === "/locations")
            return (await q.query("SELECT * FROM locations ORDER BY label"))
              .rows;
          if (path === "/drivers")
            return (
              await q.query(
                `SELECT * FROM drivers ${role === "driver" ? "WHERE user_id=$1" : role === "viewer" ? "WHERE false" : ""} ORDER BY name`,
                role === "driver" ? [s.user_id] : [],
              )
            ).rows;
          if (path === "/vehicles") {
            manage();
            return (await q.query("SELECT * FROM vehicles ORDER BY label"))
              .rows;
          }
          if (path === "/groups")
            return (
              await q.query(
                "SELECT id,name,owner_tenant_id FROM partner_groups ORDER BY name",
              )
            ).rows;
          if (path === "/audit") {
            admin();
            return (
              await q.query(
                "SELECT * FROM audit_events ORDER BY occurred_at DESC LIMIT 100",
              )
            ).rows;
          }
          if (path === "/invitations") {
            admin();
            return (
              await q.query(
                "SELECT id,email,role,expires_at,revoked,accepted FROM invitations ORDER BY expires_at DESC LIMIT 100",
              )
            ).rows;
          }
          if (path === "/courses" || /^\/courses\/[a-f0-9-]+$/.test(path)) {
            const id = path.split("/")[2];
            const params: any[] = [s.user_id, role];
            let filter = "";
            if (id) {
              params.push(input.uuid.parse(id));
              filter += " AND c.id=$3";
            }
            if (req.query.date) {
              const date = z.iso.date().parse(req.query.date);
              params.push(date);
              filter += ` AND (c.pickup_at AT TIME ZONE 'Europe/Paris')::date=$${params.length}::date`;
            }
            const rows = (
              await q.query(
                `SELECT c.*, (c.appointment_at - c.arrival_buffer*interval '1 minute') AS dropoff_deadline,a.driver_id,a.vehicle_id,d.name AS driver_name FROM courses c LEFT JOIN assignments a ON a.course_id=c.id LEFT JOIN drivers d ON d.id=a.driver_id WHERE ($2 IN ('admin','dispatcher') OR ($2='driver' AND d.user_id=$1))${filter} ORDER BY c.pickup_at LIMIT 500`,
                params,
              )
            ).rows;
            if (id) {
              requireThat(rows[0], 404, "NOT_FOUND");
              return rows[0];
            }
            return rows;
          }
        }
        if (req.method === "POST") {
          if (path === "/drivers") {
            manage();
            const d = input.driverInput.parse(req.body);
            const id = randomUUID();
            if (d.user_id)
              requireThat(
                (
                  await q.query("SELECT id FROM drivers WHERE user_id=$1", [
                    d.user_id,
                  ])
                ).rows.length === 0,
                409,
                "DRIVER_ALREADY_EXISTS",
              );
            await q.query(
              "INSERT INTO drivers(id,tenant_id,user_id,name,shift_start,shift_end,start_location,end_location,breaks) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
              [
                id,
                tenant,
                d.user_id || null,
                d.name,
                d.shift_start,
                d.shift_end,
                d.start_location,
                d.end_location,
                JSON.stringify(d.breaks),
              ],
            );
            await audit(q, tenant, s.user_id, "driver.created", id);
            return { id };
          }
          if (path === "/vehicles") {
            manage();
            const d = input.vehicleInput.parse(req.body);
            const id = randomUUID();
            await q.query(
              "INSERT INTO vehicles(id,tenant_id,label,seats,accessible) VALUES($1,$2,$3,$4,$5)",
              [id, tenant, d.label, d.seats, d.accessible],
            );
            await audit(q, tenant, s.user_id, "vehicle.created", id);
            return { id };
          }
          if (path === "/groups") {
            admin();
            const d = input.groupInput.parse(req.body);
            const id = randomUUID();
            await q.query("INSERT INTO partner_groups VALUES($1,$2,$3)", [
              id,
              tenant,
              d.name,
            ]);
            await q.query("INSERT INTO group_members VALUES($1,$2)", [
              id,
              tenant,
            ]);
            await audit(q, tenant, s.user_id, "group.created", id);
            return { id };
          }
          if (path === "/invitations") {
            admin();
            const d = input.invitationInput.parse(req.body);
            const raw = token(),
              id = randomUUID();
            await q.query(
              "INSERT INTO invitations(id,tenant_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '48 hours')",
              [id, tenant, d.email.toLowerCase(), d.role, hash(raw)],
            );
            await audit(q, tenant, s.user_id, "invitation.created", id);
            return { id, token: raw };
          }
          if (/^\/invitations\/[a-f0-9-]+\/revoke$/.test(path)) {
            admin();
            const id = input.uuid.parse(path.split("/")[2]);
            requireThat(
              (
                await q.query(
                  "UPDATE invitations SET revoked=true WHERE id=$1 RETURNING id",
                  [id],
                )
              ).rows[0],
              404,
              "NOT_FOUND",
            );
            await audit(q, tenant, s.user_id, "invitation.revoked", id);
            return { ok: true };
          }
          if (path === "/courses") {
            manage();
            const d = input.courseInput.parse(req.body);
            const id = randomUUID();
            await q.query(
              "INSERT INTO courses(id,tenant_id,reference,origin,destination,pickup_at,appointment_at,arrival_buffer,passengers,accessible) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
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
              ],
            );
            await audit(q, tenant, s.user_id, "course.created", id);
            return { id };
          }
          if (/^\/courses\/[a-f0-9-]+\/assign$/.test(path)) {
            manage();
            const id = input.uuid.parse(path.split("/")[2]),
              d = input.assignmentInput.parse(req.body);
            const course = (
              await q.query("SELECT * FROM courses WHERE id=$1 FOR UPDATE", [
                id,
              ])
            ).rows[0];
            requireThat(course, 404, "NOT_FOUND");
            requireThat(course.version === d.version, 409, "PLAN_STALE");
            requireThat(
              course.status === "unassigned",
              409,
              "COURSE_NOT_ASSIGNABLE",
            );
            const driver = (
                await q.query("SELECT * FROM drivers WHERE id=$1", [
                  d.driver_id,
                ])
              ).rows[0],
              vehicle = (
                await q.query("SELECT * FROM vehicles WHERE id=$1", [
                  d.vehicle_id,
                ])
              ).rows[0];
            requireThat(driver && vehicle, 404, "NOT_FOUND");
            const times = await validateAssignment(q, course, driver, vehicle);
            await q.query(
              "INSERT INTO assignments VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                randomUUID(),
                tenant,
                id,
                driver.id,
                vehicle.id,
                times.start,
                times.end,
              ],
            );
            await q.query(
              "UPDATE courses SET status='assigned',version=version+1 WHERE id=$1",
              [id],
            );
            await audit(q, tenant, s.user_id, "course.assigned", id);
            return { id, status: "assigned", version: d.version + 1 };
          }
          if (/^\/courses\/[a-f0-9-]+\/status$/.test(path)) {
            const id = input.uuid.parse(path.split("/")[2]),
              d = input.statusInput.parse(req.body);
            const c = (
              await q.query(
                "SELECT c.*,dr.user_id AS driver_user FROM courses c LEFT JOIN assignments a ON a.course_id=c.id LEFT JOIN drivers dr ON dr.id=a.driver_id WHERE c.id=$1 FOR UPDATE OF c",
                [id],
              )
            ).rows[0];
            requireThat(c, 404, "NOT_FOUND");
            requireThat(
              role === "admin" ||
                role === "dispatcher" ||
                (role === "driver" &&
                  c.driver_user === s.user_id &&
                  d.status !== "cancelled"),
              403,
              "ACCESS_DENIED",
            );
            requireThat(c.version === d.version, 409, "PLAN_STALE");
            const allowed: Record<string, string[]> = {
              unassigned: ["cancelled"],
              assigned: ["approaching", "cancelled"],
              approaching: ["onboard", "cancelled"],
              onboard: ["completed"],
            };
            requireThat(
              allowed[c.status]?.includes(d.status),
              409,
              "INVALID_TRANSITION",
            );
            await q.query(
              "UPDATE courses SET status=$1,version=version+1 WHERE id=$2",
              [d.status, id],
            );
            await audit(q, tenant, s.user_id, "course." + d.status, id);
            return { id, status: d.status, version: d.version + 1 };
          }
        }
        throw new Fault(404, "NOT_FOUND");
      }
      const body = await dispatch();
      if (key)
        await q.query("INSERT INTO idempotency VALUES($1,$2,$3,$4,$5)", [
          tenant,
          s.user_id,
          key,
          requestHash,
          JSON.stringify(
            body?.token ? { id: body.id, token_returned: true } : body,
          ),
        ]);
      return body;
    });
    return res.status(write ? 201 : 200).json(result);
  }
  @Controller("api/v1")
  class ApiController {
    @All(["", "*path"])
    async execute(@Req() req: Request, @Res() res: Response) {
      try {
        return await handle(req, res);
      } catch (error) {
        if (error instanceof Fault)
          return res.status(error.status).json({ code: error.code });
        if (error instanceof z.ZodError)
          return res.status(400).json({
            code: "VALIDATION_ERROR",
            fields: error.issues.map((i) => i.path.join(".")),
          });
        const code = (error as any)?.code;
        if (code === "23503")
          return res.status(400).json({ code: "REFERENCE_INVALID" });
        if (code === "23505") return res.status(409).json({ code: "CONFLICT" });
        // No request body, SQL detail, token or personal information in responses/logs.
        console.error("API_ERROR", code || "UNEXPECTED");
        return res.status(500).json({ code: "INTERNAL_ERROR" });
      }
    }
  }
  @Module({ controllers: [ApiController] })
  class ApiModule {}
  const app = await NestFactory.create(ApiModule, {
    logger: false,
    bodyParser: false,
  });
  app.use(express.json({ limit: "16kb" }));
  app.use((err: any, _req: Request, res: Response, _next: any) =>
    res.status(err.status === 413 ? 413 : 400).json({ code: "INVALID_BODY" }),
  );
  app.enableShutdownHooks();
  await app.init();
  return app;
}
