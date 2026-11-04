import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("web installation cache never intercepts API calls or stores authenticated navigation", async () => {
  const handlers = new Map<string, (event: any) => void>();
  const cached: string[] = [];
  let requests = 0;
  const online = new Response("private synthetic response");
  let offline = false;
  runInNewContext(await readFile("apps/web/public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://taxilink.example" },
      clients: { claim: async () => {} },
      addEventListener: (name: string, fn: any) => handlers.set(name, fn),
    },
    URL,
    Response,
    fetch: async () => {
      requests++;
      if (offline) throw new Error("offline");
      return online;
    },
    caches: {
      open: async () => ({
        addAll: async (paths: string[]) => cached.push(...paths),
      }),
      keys: async () => [],
      match: async (path: string) =>
        new Response(
          path === "/offline.html" ? "public offline page" : "public icon",
        ),
    },
  });
  let completed: Promise<any> | undefined;
  handlers.get("install")!({
    waitUntil: (promise: Promise<any>) => {
      completed = promise;
    },
  });
  await completed;
  assert.ok(cached.length > 0);
  assert.ok(
    cached.every(
      (path) => path === "/offline.html" || path.startsWith("/icons/"),
    ),
  );
  for (const path of [
    "/api/v1/courses",
    "/api/v1/auth/me",
    "/api/v1/documents",
  ]) {
    let handled = false;
    handlers.get("fetch")!({
      request: {
        url: "https://taxilink.example" + path,
        method: "GET",
        mode: "same-origin",
      },
      respondWith: () => {
        handled = true;
      },
    });
    assert.equal(handled, false);
  }
  let response: Promise<Response> | undefined;
  const navigation = {
    request: {
      url: "https://taxilink.example/",
      method: "GET",
      mode: "navigate",
    },
    respondWith: (promise: Promise<Response>) => {
      response = promise;
    },
  };
  handlers.get("fetch")!(navigation);
  assert.equal(await response, online);
  assert.equal(requests, 1);
  offline = true;
  handlers.get("fetch")!(navigation);
  assert.equal(await (await response)!.text(), "public offline page");
  assert.ok(!cached.includes("/"));
});
