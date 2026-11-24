// Phase D: table effects and keyboard play, in a real game against hard bots.
import { expect, test } from "@playwright/test";
import { collectErrors, EN, startBotGame, step } from "./helpers";

test("effects play as the game happens, and keys drive your turn", async ({ browser }) => {
  const errors: string[] = [];
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" })).newPage();
  collectErrors(page, errors);
  // Record every effect the layer ever shows (they only live about a second).
  await page.addInitScript(() => {
    const w = window as unknown as { __fx: Set<string> };
    w.__fx = new Set();
    new MutationObserver(() => {
      document.querySelectorAll(".fx-layer > *, .fx-layer path").forEach((el) => {
        const cls = String((el as HTMLElement).className?.baseVal ?? (el as HTMLElement).className);
        w.__fx.add(cls.split("_")[1] ?? cls); // CSS-module class "_flight_ab12" -> "flight"
        if (el.classList.contains("turn-banner")) w.__fx.add("banner");
      });
    }).observe(document, { subtree: true, childList: true });
  });
  await startBotGame(page, "Alice", 5);
  await page.locator(".hero-card").first().click();

  // Our play phase: the banner announced it, and the keys work.
  const endPhase = page.getByRole("button", { name: EN.endPhase, exact: true });
  await expect(async () => {
    if (!(await endPhase.isVisible())) await step(page, { ...EN, endPhase: "\u0000never" }); // answer anything else
    await expect(endPhase).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 90_000, intervals: [100] });
  await expect(endPhase.locator("kbd")).toHaveText("E");

  const cards = page.locator(".hand .card");
  const clickable = await cards.evaluateAll((els) => els.findIndex((el) => el.classList.contains("clickable")));
  if (clickable >= 0 && clickable < 9) {
    await page.keyboard.press(String(clickable + 1));
    await expect(cards.nth(clickable)).toHaveClass(/selected/);
    await page.keyboard.press("Escape");
    await expect(cards.nth(clickable)).not.toHaveClass(/selected/);
  }
  await page.keyboard.press("e");
  await expect(endPhase).toBeHidden();

  // Play the game out; by then every kind of effect has shown.
  await expect(async () => {
    await step(page, EN);
    await expect(page.locator(".game-over")).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 150_000, intervals: [100] });
  const seen = await page.evaluate(() => [...(window as unknown as { __fx: Set<string> }).__fx]);
  for (const kind of ["banner", "flight", "line", "number"]) expect(seen, `saw a ${kind} effect`).toContain(kind);
  expect(errors).toEqual([]);
});

test("reduced motion: no effects at all", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })).newPage();
  await startBotGame(page, "Alice", 4);
  await page.locator(".hero-card").first().click();
  // Keep playing (it may be our turn first) until a few cards have hit the table.
  let effects = 0;
  await expect(async () => {
    await step(page, EN);
    effects += await page.locator(".fx-layer > *").count();
    expect(await page.locator(".plays .play-slot").count()).toBeGreaterThanOrEqual(2);
  }).toPass({ timeout: 90_000, intervals: [100] });
  expect(effects, "effects shown with reduced motion").toBe(0);
});
