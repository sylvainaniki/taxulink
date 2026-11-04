import { Fault, requireThat } from "./security";
import type { Sql, Row } from "./db";
export interface RoutingProvider {
  name: string;
  matrix(
    points: { id: string; latitude: number; longitude: number }[],
  ): Promise<{ minutes: number | null; distance_m: number | null }[][]>;
}
export function routingFromEnv(): RoutingProvider | undefined {
  if (!process.env.ROUTING_BASE_URL) return;
  const base = new URL(process.env.ROUTING_BASE_URL);
  requireThat(
    !base.username && !base.password && !base.search && !base.hash,
    500,
    "ROUTING_CONFIG_INVALID",
  );
  requireThat(
    base.protocol === "https:" ||
      (process.env.DEMO_MODE === "true" &&
        process.env.ROUTING_ALLOW_LOCAL === "true" &&
        ["localhost", "127.0.0.1", "osrm"].includes(base.hostname)),
    500,
    "ROUTING_HTTPS_REQUIRED",
  );
  const factor = Number(process.env.ROUTING_SAFETY_FACTOR || "1.25");
  requireThat(
    Number.isFinite(factor) && factor >= 1 && factor <= 2,
    500,
    "ROUTING_CONFIG_INVALID",
  );
  return {
    name: "osrm-static",
    matrix: async (points) => {
      const coordinates = points
        .map((p) => `${p.longitude},${p.latitude}`)
        .join(";");
      const url = new URL(
        `${base.href.replace(/\/$/, "")}/table/v1/driving/${coordinates}`,
      );
      url.searchParams.set("annotations", "duration,distance");
      url.searchParams.set("generate_hints", "false");
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        });
        requireThat(response.ok, 503, "ROUTING_PROVIDER_UNAVAILABLE");
        const content = await response.text();
        requireThat(content.length <= 2000000, 503, "ROUTING_PROVIDER_INVALID");
        const data = JSON.parse(content);
        requireThat(
          data.code === "Ok" &&
            data.durations?.length === points.length &&
            data.distances?.length === points.length,
          503,
          "ROUTING_PROVIDER_INVALID",
        );
        return points.map((_, i) =>
          points.map((_, j) => {
            const seconds = data.durations[i]?.[j],
              distance = data.distances[i]?.[j];
            if (seconds === null || distance === null)
              return { minutes: null, distance_m: null };
            requireThat(
              Number.isFinite(seconds) &&
                seconds >= 0 &&
                seconds <= 172800 &&
                Number.isFinite(distance) &&
                distance >= 0,
              503,
              "ROUTING_PROVIDER_INVALID",
            );
            return {
              minutes: Math.ceil((seconds * factor) / 60),
              distance_m: Math.ceil(distance),
            };
          }),
        );
      } catch (e) {
        if (e instanceof Fault) throw e;
        throw new Fault(503, "ROUTING_PROVIDER_UNAVAILABLE");
      }
    },
  };
}
export async function refreshRoutes(
  q: Sql,
  tenant: string,
  ids: string[],
  provider: RoutingProvider,
  quota = 50,
) {
  const unique = [...new Set(ids)];
  requireThat(
    unique.length >= 1 && unique.length <= 20,
    400,
    "ROUTING_BATCH_INVALID",
  );
  const points = (
    await q.query("SELECT routing_coordinates($1::text[]) AS data", [unique])
  ).rows[0].data as Row[];
  requireThat(points.length === unique.length, 404, "NOT_FOUND");
  requireThat(
    points.every(
      (p) => p.validated_at && p.latitude !== null && p.longitude !== null,
    ),
    422,
    "COORDINATES_UNCONFIRMED",
  );
  await q.query(
    "INSERT INTO routing_usage(tenant_id,calls) VALUES($1,0) ON CONFLICT DO NOTHING",
    [tenant],
  );
  const usage = (
    await q.query(
      "UPDATE routing_usage SET calls=calls+1 WHERE tenant_id=$1 AND day=current_date AND calls<$2 RETURNING calls",
      [tenant, quota],
    )
  ).rows[0];
  requireThat(usage, 429, "ROUTING_QUOTA_REACHED");
  const matrix = await provider.matrix(points as any);
  let stored = 0,
    unavailable = 0;
  for (let i = 0; i < points.length; i++)
    for (let j = 0; j < points.length; j++) {
      const route = matrix[i]?.[j];
      requireThat(
        route &&
          (route.minutes === null ||
            (Number.isInteger(route.minutes) && route.minutes >= 0)) &&
          (route.distance_m === null ||
            (Number.isInteger(route.distance_m) && route.distance_m >= 0)),
        503,
        "ROUTING_PROVIDER_INVALID",
      );
      if (route.minutes === null) {
        await q.query(
          "UPDATE routes SET expires_at=now() WHERE origin=$1 AND destination=$2 AND tenant_id=$3",
          [points[i].id, points[j].id, tenant],
        );
        unavailable++;
        continue;
      }
      await q.query(
        "INSERT INTO routes(origin,destination,minutes,provider,expires_at,tenant_id,distance_m) VALUES($1,$2,$3,$4,now()+interval '6 hours',$5,$6) ON CONFLICT(origin,destination) DO UPDATE SET minutes=EXCLUDED.minutes,provider=EXCLUDED.provider,expires_at=EXCLUDED.expires_at,distance_m=EXCLUDED.distance_m,calculated_at=now() WHERE routes.tenant_id=$5",
        [
          points[i].id,
          points[j].id,
          route.minutes,
          provider.name,
          tenant,
          route.distance_m,
        ],
      );
      stored++;
    }
  return {
    stored,
    unavailable,
    provider: provider.name,
    traffic: "static",
    expires_in_hours: 6,
    calls_today: usage.calls,
  };
}
