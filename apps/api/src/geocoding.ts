import { z } from "zod";
import { Fault, requireThat } from "./security";
export const searchInput = z
  .object({
    query: z.string().trim().min(4).max(180),
    kind: z.enum(["address", "poi"]),
  })
  .strict();
export interface Geocoder {
  search(
    query: string,
    kind: "address" | "poi",
  ): Promise<
    {
      label: string;
      address: string;
      sector: string;
      latitude: number;
      longitude: number;
      source: string;
    }[]
  >;
}
export function ignGeocoder(transport: typeof fetch = fetch): Geocoder {
  let windowStart = 0,
    calls = 0;
  return {
    search: async (query, kind) => {
      const input = searchInput.parse({ query, kind });
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        calls = 0;
      }
      requireThat(++calls <= 4, 429, "GEOCODING_RATE_LIMIT");
      const url = new URL("https://data.geopf.fr/geocodage/search");
      url.searchParams.set("q", input.query);
      url.searchParams.set("index", input.kind);
      url.searchParams.set("limit", "5");
      try {
        const response = await transport(url, {
          redirect: "error",
          signal: AbortSignal.timeout(7000),
          headers: { Accept: "application/json" },
        });
        requireThat(response.ok, 503, "GEOCODING_UNAVAILABLE");
        const reader = response.body?.getReader();
        requireThat(reader, 503, "GEOCODING_INVALID");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            requireThat(size <= 250000, 503, "GEOCODING_INVALID");
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel();
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        requireThat(
          Array.isArray(data.features) && data.features.length <= 50,
          503,
          "GEOCODING_INVALID",
        );
        return data.features.slice(0, 5).flatMap((f: any) => {
          const [longitude, latitude] = f.geometry?.coordinates || [],
            p = f.properties || {};
          const label = p.label || p.name,
            sector = p.city || p.citycode || p.postcode;
          if (
            f.geometry?.type !== "Point" ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180 ||
            typeof label !== "string" ||
            typeof sector !== "string"
          )
            return [];
          return [
            {
              label: label.slice(0, 80),
              address: label.slice(0, 200),
              sector: sector.slice(0, 80),
              latitude,
              longitude,
              source: "IGN Géoplateforme",
            },
          ];
        });
      } catch (e) {
        if (e instanceof Fault) throw e;
        throw new Fault(503, "GEOCODING_UNAVAILABLE");
      }
    },
  };
}
