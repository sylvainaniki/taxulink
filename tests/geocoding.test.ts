import { test } from "node:test";
import assert from "node:assert/strict";
import { ignGeocoder, searchInput } from "../apps/api/src/geocoding";

test("geocoding uses only the fixed IGN endpoint and projects valid public place fields", async () => {
  let requested: URL | undefined;
  const provider = ignGeocoder((async (url: any) => {
    requested = new URL(url);
    return new Response(
      JSON.stringify({
        features: [
          {
            geometry: { type: "Point", coordinates: [1.4, 43.6] },
            properties: {
              label: "Établissement fictif Toulouse",
              city: ["Toulouse"],
              private_field: "must not be returned",
            },
          },
          {
            geometry: { type: "Point", coordinates: [400, 43] },
            properties: { label: "Invalid", city: "Toulouse" },
          },
        ],
      }),
    );
  }) as typeof fetch);
  const results = await provider.search("Établissement Toulouse", "poi");
  assert.equal(requested!.origin, "https://data.geopf.fr");
  assert.equal(requested!.pathname, "/geocodage/search");
  assert.equal(requested!.searchParams.get("index"), "poi");
  assert.equal(results.length, 1);
  assert.equal(results[0].latitude, 43.6);
  assert.ok(!JSON.stringify(results).includes("private_field"));
  assert.equal(
    searchInput.safeParse({
      query: "Toulouse",
      kind: "address",
      patient_name: "Synthetic",
    }).success,
    false,
  );
});
test("geocoding refuses unbounded responses, unavailable providers and bursts", async () => {
  const huge = ignGeocoder(
    (async () => new Response("x".repeat(250001))) as typeof fetch,
  );
  await assert.rejects(huge.search("Toulouse", "address"), /GEOCODING_INVALID/);
  const down = ignGeocoder((async () => {
    throw new Error("private upstream diagnostic");
  }) as typeof fetch);
  await assert.rejects(
    down.search("Toulouse", "address"),
    /GEOCODING_UNAVAILABLE/,
  );
  const limited = ignGeocoder(
    (async () => new Response('{"features":[]}')) as typeof fetch,
  );
  for (let i = 0; i < 4; i++) await limited.search("Toulouse", "address");
  await assert.rejects(
    limited.search("Toulouse", "address"),
    /GEOCODING_RATE_LIMIT/,
  );
});
