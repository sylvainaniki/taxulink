import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const runtime = createRequire(
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/runtime.js",
  );
  ({ chromium } = runtime("playwright"));
}
assert.ok(
  process.env.DEMO_PASSWORD,
  "DEMO_PASSWORD must match the seeded database",
);
const browser = await chromium.launch({
  headless: true,
  executablePath: chromium.executablePath(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const failures = [];
page.on("pageerror", (e) => failures.push(e.message));
await mkdir(".data/qa", { recursive: true });
try {
  await page.goto("http://localhost:3000");
  await page.getByLabel("Mot de passe").fill(process.env.DEMO_PASSWORD);
  await page.getByRole("button", { name: "Ouvrir mon espace" }).click();
  await page
    .getByRole("heading", { name: "Une journée bien coordonnée." })
    .waitFor();
  await page.getByText("DEMO-ATLAS-1", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("DEMO-HORIZON-1", { exact: true }).count(),
    0,
  );
  await page.screenshot({
    path: ".data/qa/planning-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "＋ Nouvelle course" }).click();
  await page.getByLabel("Référence fictive").fill("DEMO-E2E");
  await page.getByLabel("Prise en charge (Paris)").fill("17:00");
  await page.getByLabel("Rendez-vous (Paris)").fill("18:00");
  await page.getByRole("button", { name: "Confirmer →" }).click();
  await page.getByText("DEMO-E2E", { exact: true }).waitFor();
  const row = page.locator("article.course").filter({ hasText: "DEMO-E2E" });
  await row.getByRole("button", { name: "Attribuer →" }).click();
  await page
    .getByLabel("Chauffeur", { exact: true })
    .selectOption({ index: 1 });
  await page.getByLabel("Véhicule", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Confirmer →" }).click();
  await row.getByText("Attribuée", { exact: true }).waitFor();
  for (const name of ["En approche", "À bord", "Terminer"])
    await row.getByRole("button", { name, exact: true }).click();
  await row.getByText("Terminée", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: ".data/qa/planning-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
  await page.getByRole("heading", { name: "Connexion", exact: true }).waitFor();
  await page.getByLabel("Adresse email").fill("driver@atlas.example");
  await page.getByLabel("Mot de passe").fill(process.env.DEMO_PASSWORD);
  await page.getByRole("button", { name: "Ouvrir mon espace" }).click();
  await page
    .getByRole("heading", { name: "Une journée bien coordonnée." })
    .waitFor();
  await page.getByText("DEMO-E2E", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "＋ Nouvelle course" }).count(),
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".data/qa/driver-mobile.png", fullPage: true });
  assert.deepEqual(failures, []);
  console.log(
    "E2E passed: login, tenant boundary, create/assign/complete, mobile overflow, logout, driver role.",
  );
} finally {
  await browser.close();
}
