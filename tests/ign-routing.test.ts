import { test } from "node:test";
import assert from "node:assert/strict";
import { ignRouting } from "../apps/api/src/ign-routing";
const points = [
  { id: "a", latitude: 43.6, longitude: 1.4 },
  { id: "b", latitude: 43.61, longitude: 1.41 },
];
test("IGN routing sends only points, computes both directions, applies the margin and preserves metre distances", async () => {
  const bodies: any[] = [];
  const provider = ignRouting(
    (async (url, options) => {
      assert.equal(String(url), "https://data.geopf.fr/navigation/itineraire");
      bodies.push(JSON.parse(String(options!.body)));
      return new Response(
        JSON.stringify({
          duration: bodies.length === 1 ? 600 : 900,
          distance: 3500,
        }),
      );
    }) as typeof fetch,
    async () => {},
  );
  const m = await provider.matrix(points);
  assert.deepEqual(m, [
    [
      { minutes: 0, distance_m: 0 },
      { minutes: 13, distance_m: 3500 },
    ],
    [
      { minutes: 19, distance_m: 3500 },
      { minutes: 0, distance_m: 0 },
    ],
  ]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].start, "1.4,43.6");
  assert.equal(bodies[1].start, "1.41,43.61");
  assert.ok(!JSON.stringify(bodies).includes('"id"'));
  assert.equal(bodies[0].resource, "bdtopo-valhalla");
});
test("routing refuses malformed results and oversized batches without substituting fictional times", async () => {
  let calls = 0;
  const provider = ignRouting(
    (async () => {
      calls++;
      return new Response('{"duration":-1,"distance":30}');
    }) as typeof fetch,
    async () => {},
  );
  await assert.rejects(
    provider.matrix([...points, ...points, ...points]),
    /ROUTING_BATCH_INVALID/,
  );
  assert.equal(calls, 0);
  await assert.rejects(provider.matrix(points), /ROUTING_PROVIDER_INVALID/);
  // A failed calculation releases the provider, allowing a deliberate later retry.
  await assert.rejects(provider.matrix(points), /ROUTING_PROVIDER_INVALID/);
  assert.equal(calls, 2);
});
