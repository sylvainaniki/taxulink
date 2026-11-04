import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql, Row } from "../db";
import type { Context } from "./operations";
import { assign, snapshot } from "./operations";
import { Fault, requireThat } from "../security";

export async function optimization(q: Sql, c: Context) {
  const { path, method, tenant, user, role } = c;
  if (method !== "POST") return;
  if (
    path === "/plans/propose" &&
    (c.body.strategy === "search" || c.body.replan === true)
  ) {
    requireThat(["admin", "dispatcher"].includes(role), 403, "ACCESS_DENIED");
    const d = z
      .object({
        date: z.iso.date(),
        strategy: z.literal("search").default("search"),
        replan: z.boolean().default(false),
        max_seconds: z.number().int().min(1).max(10).default(3),
      })
      .strict()
      .parse(c.body);
    const version = await snapshot(q),
      policy = (await q.query("SELECT * FROM company_settings")).rows[0];
    const threshold = new Date(
      Date.now() + (policy?.freeze_minutes ?? 60) * 60000,
    ).toISOString();
    const jobs = (
      await q.query(
        "SELECT c.*,a.driver_id AS old_driver,a.vehicle_id AS old_vehicle FROM courses c LEFT JOIN assignments a ON a.course_id=c.id WHERE (pickup_at AT TIME ZONE 'Europe/Paris')::date=$1::date AND NOT course_has_live_offer(c.id) AND (status='unassigned' OR ($2 AND status IN ('assigned','confirmed') AND pickup_at>$3 AND source_course_id IS NULL AND NOT shared_source(c.id))) ORDER BY priority DESC,appointment_at,id",
        [d.date, d.replan, threshold],
      )
    ).rows;
    requireThat(jobs.length <= 50, 422, "SEARCH_BATCH_TOO_LARGE");
    const drivers = (
        await q.query("SELECT * FROM drivers WHERE active ORDER BY id")
      ).rows,
      vehicles = (
        await q.query("SELECT * FROM vehicles WHERE active ORDER BY id")
      ).rows;
    const required = new Set(jobs.filter((j) => j.old_driver).map((j) => j.id));
    const previous = jobs
      .filter((j) => j.old_driver)
      .map((j) => ({
        course_id: j.id,
        driver_id: j.old_driver,
        vehicle_id: j.old_vehicle,
        status: j.status,
      }));
    const started = Date.now(),
      deadline = started + d.max_seconds * 1000;
    const reasons = new Map<string, Set<string>>();
    let best: Row[] | null = null,
      bestScore = -Infinity,
      nodes = 0,
      exhausted = false;
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    function record(plan: Row[]) {
      if ([...required].some((id) => !plan.some((p) => p.course_id === id)))
        return;
      const load = new Map<string, number>();
      for (const item of plan)
        load.set(item.driver_id, (load.get(item.driver_id) || 0) + 1);
      const changed = plan.filter(
        (p) =>
          jobById.get(p.course_id)?.old_driver &&
          (jobById.get(p.course_id)?.old_driver !== p.driver_id ||
            jobById.get(p.course_id)?.old_vehicle !== p.vehicle_id),
      ).length;
      const score =
        plan.length * 100000 +
        plan.reduce(
          (sum, p) =>
            sum + Number(jobById.get(p.course_id)?.priority || 0) * 100,
          0,
        ) -
        changed * 10 -
        [...load.values()].reduce((sum, n) => sum + n * n, 0);
      if (score > bestScore) {
        bestScore = score;
        best = plan.map((p) => ({ ...p }));
      }
    }
    const candidates = (job: Row) =>
      drivers
        .flatMap((driver) =>
          vehicles
            .filter(
              (v) =>
                v.seats >= job.passengers && (!job.accessible || v.accessible),
            )
            .map((vehicle) => ({ driver, vehicle })),
        )
        .sort(
          (a, b) =>
            Number(
              b.driver.id === job.old_driver &&
                b.vehicle.id === job.old_vehicle,
            ) -
            Number(
              a.driver.id === job.old_driver &&
                a.vehicle.id === job.old_vehicle,
            ),
        );
    async function tryAssignment(
      job: Row,
      pair: ReturnType<typeof candidates>[number],
      plan: Row[],
      next: () => Promise<void>,
      point: string,
    ) {
      await q.query(`SAVEPOINT ${point}`);
      try {
        await assign(q, tenant, job, pair.driver.id, pair.vehicle.id);
        nodes++;
        plan.push({
          course_id: job.id,
          driver_id: pair.driver.id,
          vehicle_id: pair.vehicle.id,
        });
        record(plan);
        try {
          await next();
        } finally {
          plan.pop();
        }
      } catch (e) {
        if (!(e instanceof Fault)) throw e;
        const set = reasons.get(job.id) || new Set();
        set.add(e.code);
        reasons.set(job.id, set);
      } finally {
        await q.query(`ROLLBACK TO SAVEPOINT ${point}`);
        await q.query(`RELEASE SAVEPOINT ${point}`);
      }
    }
    await q.query("SAVEPOINT optimization");
    try {
      for (const item of previous)
        await q.query("DELETE FROM assignments WHERE course_id=$1", [
          item.course_id,
        ]);
      // A first feasible construction protects already committed missions before searching alternatives.
      const order = [...jobs].sort(
        (a, b) =>
          Number(Boolean(b.old_driver)) - Number(Boolean(a.old_driver)) ||
          Number(b.priority) - Number(a.priority) ||
          Date.parse(a.appointment_at) - Date.parse(b.appointment_at),
      );
      await q.query("SAVEPOINT construction");
      const construction: Row[] = [];
      for (const job of order) {
        if (Date.now() > deadline) {
          exhausted = true;
          break;
        }
        for (const pair of candidates(job)) {
          if (Date.now() > deadline) {
            exhausted = true;
            break;
          }
          await q.query("SAVEPOINT greedy_candidate");
          try {
            await assign(q, tenant, job, pair.driver.id, pair.vehicle.id);
            construction.push({
              course_id: job.id,
              driver_id: pair.driver.id,
              vehicle_id: pair.vehicle.id,
            });
            nodes++;
            await q.query("RELEASE SAVEPOINT greedy_candidate");
            break;
          } catch (e) {
            await q.query("ROLLBACK TO SAVEPOINT greedy_candidate");
            await q.query("RELEASE SAVEPOINT greedy_candidate");
            if (!(e instanceof Fault)) throw e;
            const set = reasons.get(job.id) || new Set();
            set.add(e.code);
            reasons.set(job.id, set);
          }
        }
      }
      record(construction);
      await q.query("ROLLBACK TO SAVEPOINT construction");
      await q.query("RELEASE SAVEPOINT construction");
      if (jobs.length <= 10 && drivers.length * vehicles.length <= 16) {
        async function search(index: number, plan: Row[]): Promise<void> {
          if (Date.now() > deadline || nodes > 2000) {
            exhausted = true;
            return;
          }
          record(plan);
          if (index === order.length) return;
          if (best && plan.length + order.length - index < best.length) return;
          const job = order[index];
          for (const pair of candidates(job)) {
            if (Date.now() > deadline || nodes > 2000) {
              exhausted = true;
              break;
            }
            await tryAssignment(
              job,
              pair,
              plan,
              () => search(index + 1, plan),
              `search_${index}`,
            );
          }
          if (!required.has(job.id)) await search(index + 1, plan);
        }
        await search(0, []);
      } else exhausted = true;
    } finally {
      await q.query("ROLLBACK TO SAVEPOINT optimization");
      await q.query("RELEASE SAVEPOINT optimization");
    }
    requireThat(best !== null, 422, "NO_FEASIBLE_REPLAN");
    const assigned = best as Row[],
      unassigned = jobs
        .filter((j) => !assigned.some((p) => p.course_id === j.id))
        .map((j) => ({
          course_id: j.id,
          reasons: [
            ...(reasons.get(j.id) ||
              new Set([exhausted ? "CALCULATION_BUDGET" : "NO_DRIVER"])),
          ],
        }));
    const changed = previous.filter((old) => {
      const next = assigned.find((p) => p.course_id === old.course_id);
      return (
        next?.driver_id !== old.driver_id || next?.vehicle_id !== old.vehicle_id
      );
    });
    const proposal = {
      assigned,
      unassigned,
      previous,
      changed,
      algorithm: "time-window-search-v1",
      replan: d.replan,
      score: bestScore,
      nodes,
      budget_exhausted: exhausted,
      optimality_proven: !exhausted,
      elapsed_ms: Date.now() - started,
      freeze_minutes: policy?.freeze_minutes ?? 60,
    };
    const id = randomUUID();
    await q.query(
      "INSERT INTO planning_proposals VALUES($1,$2,$3,now(),now()+interval '10 minutes',$4,$5,'proposed')",
      [id, tenant, user, version, JSON.stringify(proposal)],
    );
    await c.audit(q, tenant, user, "plan.optimized", id);
    return { value: { id, ...proposal } };
  }
  if (/^\/plans\/[a-f0-9-]+\/apply$/.test(path)) {
    const id = z.uuid().parse(path.split("/")[2]),
      plan = (
        await q.query(
          "SELECT * FROM planning_proposals WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
    if (plan?.proposal.algorithm !== "time-window-search-v1") return;
    requireThat(["admin", "dispatcher"].includes(role), 403, "ACCESS_DENIED");
    requireThat(
      plan.status === "proposed" &&
        Date.parse(plan.expires_at) > Date.now() &&
        plan.snapshot === (await snapshot(q)),
      409,
      "PLAN_STALE",
    );
    const previous = plan.proposal.previous as Row[];
    for (const old of previous) {
      const job = (
        await q.query("SELECT * FROM courses WHERE id=$1 FOR UPDATE", [
          old.course_id,
        ])
      ).rows[0];
      requireThat(
        ["assigned", "confirmed"].includes(job.status) &&
          Date.parse(job.pickup_at) >
            Date.now() + plan.proposal.freeze_minutes * 60000 &&
          !job.source_course_id,
        409,
        "COURSE_FROZEN",
      );
      await q.query(
        "INSERT INTO assignment_history(id,tenant_id,course_id,details) SELECT gen_random_uuid(),tenant_id,course_id,to_jsonb(a) FROM assignments a WHERE course_id=$1",
        [old.course_id],
      );
      await q.query("DELETE FROM assignments WHERE course_id=$1", [
        old.course_id,
      ]);
    }
    for (const item of plan.proposal.assigned) {
      const job = (
        await q.query("SELECT * FROM courses WHERE id=$1", [item.course_id])
      ).rows[0];
      requireThat(
        job &&
          (job.status === "unassigned" ||
            previous.some((p) => p.course_id === job.id)),
        409,
        "PLAN_STALE",
      );
      await assign(q, tenant, job, item.driver_id, item.vehicle_id);
      if (previous.find((p) => p.course_id === job.id)?.status === "confirmed")
        await q.query("UPDATE courses SET status='confirmed' WHERE id=$1", [
          job.id,
        ]);
      await c.audit(q, tenant, user, "course.planned", job.id);
    }
    await q.query(
      "UPDATE planning_proposals SET status='applied' WHERE id=$1",
      [id],
    );
    await c.audit(q, tenant, user, "plan.applied", id);
    return {
      value: {
        id,
        status: "applied",
        count: plan.proposal.assigned.length,
        changed: plan.proposal.changed.length,
      },
    };
  }
}
