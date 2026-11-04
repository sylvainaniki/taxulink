import type { RoutingProvider } from "./routing";
import { Fault, requireThat } from "./security";
// No names, contact fields or tenant identifiers are sent to the route service.
export function ignRouting(
  transport: typeof fetch = fetch,
  pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
): RoutingProvider {
  let busy = false;
  return {
    name: "ign-bdtopo-static",
    maxPoints: 4,
    matrix: async (points) => {
      requireThat(
        points.length >= 1 && points.length <= 4,
        400,
        "ROUTING_BATCH_INVALID",
      );
      requireThat(
        points.every(
          (p) =>
            Number.isFinite(p.latitude) &&
            Number.isFinite(p.longitude) &&
            Math.abs(p.latitude) <= 90 &&
            Math.abs(p.longitude) <= 180,
        ),
        400,
        "COORDINATES_UNCONFIRMED",
      );
      requireThat(!busy, 429, "ROUTING_BUSY");
      busy = true;
      try {
        const matrix: {
          minutes: number | null;
          distance_m: number | null;
        }[][] = [];
        for (let i = 0; i < points.length; i++) {
          matrix[i] = [];
          for (let j = 0; j < points.length; j++) {
            if (i === j) {
              matrix[i][j] = { minutes: 0, distance_m: 0 };
              continue;
            }
            await pause(300);
            const response = await transport(
              "https://data.geopf.fr/navigation/itineraire",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                redirect: "error",
                signal: AbortSignal.timeout(7000),
                body: JSON.stringify({
                  resource: "bdtopo-valhalla",
                  start: `${points[i].longitude},${points[i].latitude}`,
                  end: `${points[j].longitude},${points[j].latitude}`,
                  profile: "car",
                  optimization: "fastest",
                  getSteps: false,
                  getBbox: false,
                  geometryFormat: "polyline",
                  timeUnit: "second",
                  distanceUnit: "meter",
                }),
              },
            );
            requireThat(response.ok, 503, "ROUTING_PROVIDER_UNAVAILABLE");
            const reader = response.body?.getReader();
            requireThat(reader, 503, "ROUTING_PROVIDER_INVALID");
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                size += part.value.length;
                requireThat(size <= 2000000, 503, "ROUTING_PROVIDER_INVALID");
                chunks.push(part.value);
              }
            } finally {
              await reader.cancel();
            }
            const d = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            requireThat(
              Number.isFinite(d.duration) &&
                d.duration >= 0 &&
                d.duration <= 172800 &&
                Number.isFinite(d.distance) &&
                d.distance >= 0,
              503,
              "ROUTING_PROVIDER_INVALID",
            );
            // Static durations, with an explicit 25% scheduling buffer. No live traffic.
            matrix[i][j] = {
              minutes: Math.ceil((d.duration * 1.25) / 60),
              distance_m: Math.ceil(d.distance),
            };
          }
        }
        return matrix;
      } catch (e) {
        if (e instanceof Fault) throw e;
        throw new Fault(503, "ROUTING_PROVIDER_UNAVAILABLE");
      } finally {
        busy = false;
      }
    },
  };
}
