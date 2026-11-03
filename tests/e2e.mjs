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
  // Exercise two independent browser sessions through the actual UI.
  async function signedIn(email) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => failures.push(e.message));
    await p.goto("http://localhost:3000");
    await p.getByLabel("Adresse email").fill(email);
    await p.getByLabel("Mot de passe").fill(process.env.DEMO_PASSWORD);
    await p.getByRole("button", { name: "Ouvrir mon espace" }).click();
    await p
      .getByRole("heading", { name: "Une journée bien coordonnée." })
      .waitFor();
    return p;
  }
  const owner = await signedIn("admin@atlas.example"),
    buyer = await signedIn("admin@horizon.example");
  await owner.getByRole("button", { name: "＋ Nouvelle course" }).click();
  await owner.getByLabel("Référence fictive").fill("DEMO-E2E-NET");
  await owner.getByLabel("Prise en charge (Paris)").fill("10:00");
  await owner.getByLabel("Rendez-vous (Paris)").fill("11:00");
  await owner.getByRole("button", { name: "Confirmer →" }).click();
  await owner.getByText("DEMO-E2E-NET", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "Bourse" }).click();
  await owner
    .getByText("＋ Proposer une course au réseau", { exact: true })
    .click();
  const source = owner.getByLabel("Course à proposer");
  const sourceId = await source
    .locator("option")
    .filter({ hasText: "DEMO-E2E-NET" })
    .getAttribute("value");
  await source.selectOption(sourceId);
  await owner
    .getByRole("button", { name: "Publier l’offre", exact: true })
    .click();
  await owner
    .locator(".offer-card")
    .getByText("Disponible", { exact: true })
    .waitFor();
  await buyer.getByRole("button", { name: "Bourse" }).click();
  await buyer
    .locator(".offer-card")
    .getByRole("button", { name: "Réserver", exact: true })
    .click();
  assert.equal(
    await buyer.getByText("DEMO-E2E-NET", { exact: true }).count(),
    0,
  );
  await buyer
    .getByRole("button", { name: "Confirmer la réservation", exact: true })
    .click();
  await buyer
    .getByText("Réservée · validation en attente", { exact: true })
    .waitFor();
  await buyer.getByRole("button", { name: "Planning" }).click();
  await buyer.getByText("DEMO-HORIZON-1", { exact: true }).waitFor();
  assert.equal(
    await buyer.getByText("DEMO-E2E-NET", { exact: true }).count(),
    0,
  );
  await owner
    .getByRole("button", { name: "Confirmer le transfert", exact: true })
    .click();
  await owner.getByText("Transfert confirmé", { exact: true }).waitFor();
  await buyer.getByRole("button", { name: "Courses", exact: false }).click();
  await buyer.getByText("DEMO-E2E-NET", { exact: true }).waitFor();
  await owner.getByRole("button", { name: "Messages", exact: false }).click();
  await owner.getByLabel("Conversation du groupe").selectOption({ index: 1 });
  await owner
    .getByLabel("Votre message")
    .fill("Message E2E fictif sans information patient");
  await owner
    .getByRole("button", { name: "Envoyer le message", exact: true })
    .click();
  await owner
    .getByText("Message E2E fictif sans information patient", { exact: true })
    .waitFor();
  await buyer.getByRole("button", { name: "Messages", exact: false }).click();
  await buyer.getByLabel("Conversation du groupe").selectOption({ index: 1 });
  await buyer
    .getByText("Message E2E fictif sans information patient", { exact: true })
    .waitFor();
  await owner
    .getByRole("button", { name: "Optimisation", exact: false })
    .click();
  await owner
    .getByRole("button", { name: "Calculer une proposition", exact: true })
    .click();
  await owner
    .locator(".plan-card")
    .first()
    .getByRole("button", { name: "Appliquer cette proposition", exact: true })
    .click();
  await owner
    .getByText("Planning confirmé et enregistré.", { exact: true })
    .waitFor();
  for (const viewport of [
    { width: 1440, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await buyer.setViewportSize(viewport);
    assert.equal(
      await buyer.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
  }
  await buyer.screenshot({
    path: ".data/qa/network-chat-mobile.png",
    fullPage: true,
  });
  async function mailboxLink(kind) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await fetch(
        "http://localhost:8025/api/v1/message/latest",
      );
      if (response.ok) {
        const message = await response.json();
        const link = message.Text?.match(
          new RegExp(`http://localhost:3000/#${kind}=[a-f0-9]{64}`),
        )?.[0];
        if (link) return link;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      "Expected account email was not delivered to the local test mailbox",
    );
  }
  await owner.getByRole("button", { name: "Compte", exact: false }).click();
  await owner
    .getByRole("button", {
      name: "Envoyer le lien de confirmation",
      exact: true,
    })
    .click();
  const recoveryContext = await browser.newContext();
  const recoveryPage = await recoveryContext.newPage();
  recoveryPage.on("pageerror", (e) => failures.push(e.message));
  const verificationLink = await mailboxLink("verify");
  await recoveryPage.goto(verificationLink);
  await recoveryPage
    .getByRole("button", { name: "Confirmer mon adresse", exact: true })
    .click();
  await recoveryPage
    .getByText("Adresse email vérifiée.", { exact: false })
    .waitFor();
  assert.equal(new URL(recoveryPage.url()).hash, "");
  await recoveryPage.goto(verificationLink);
  await recoveryPage
    .getByRole("button", { name: "Confirmer mon adresse", exact: true })
    .click();
  await recoveryPage
    .getByText("Lien expiré, remplacé ou déjà utilisé.", { exact: false })
    .waitFor();
  await recoveryPage
    .getByRole("button", { name: "Retour à la connexion", exact: true })
    .click();
  await recoveryPage
    .getByRole("button", { name: "Mot de passe oublié", exact: true })
    .click();
  await recoveryPage.getByLabel("Adresse email").fill("admin@atlas.example");
  await recoveryPage
    .getByRole("button", { name: "Envoyer le lien", exact: true })
    .click();
  await recoveryPage
    .getByText("Si un compte correspond", { exact: false })
    .waitFor();
  await recoveryPage.goto(await mailboxLink("reset"));
  await recoveryPage
    .getByLabel("Nouveau mot de passe", { exact: true })
    .fill("E2E-recovered-synthetic-password-2026");
  await recoveryPage
    .getByRole("button", { name: "Enregistrer le mot de passe", exact: true })
    .click();
  await recoveryPage
    .getByText("Mot de passe modifié.", { exact: false })
    .waitFor();
  await recoveryPage
    .getByRole("button", { name: "Retour à la connexion", exact: true })
    .click();
  await recoveryPage
    .getByLabel("Mot de passe", { exact: true })
    .fill("E2E-recovered-synthetic-password-2026");
  await recoveryPage
    .getByRole("button", { name: "Ouvrir mon espace", exact: false })
    .click();
  await recoveryPage
    .getByRole("heading", { name: "Une journée bien coordonnée." })
    .waitFor();
  await recoveryContext.close();
  assert.deepEqual(failures, []);
  console.log(
    "E2E passed: login, tenant boundary, create/assign/complete, mobile overflow, logout, driver role, private marketplace/owner confirmation, cross-company group chat, proposal/apply planning.",
  );
} finally {
  await browser.close();
}
