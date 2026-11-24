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
    if (await page.locator(".game-over").isVisible().catch(() => false)) {
      // The game was over before our turn came round (strong heroes can do that): rematch.
      await page.getByRole("button", { name: "Rematch" }).click();
    }
    await step(page, EN, { holdPlay: true }); // answer anything but our play phase
    await expect(endPhase).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 120_000, intervals: [100] });
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

  // Enter confirms even though the card you clicked still has keyboard focus (it used to
  // "press" the focused card again instead). Tried on each of our turns until one has a
  // playable card; the game is then played out.
  let enterUsed = false;
  const use = page.getByRole("button", { name: EN.use, exact: true });
  await expect(async () => {
    if (!enterUsed && (await endPhase.isVisible().catch(() => false))) {
      const card = page.locator(".hand .card.clickable").first();
      if (await card.isVisible().catch(() => false)) {
        const before = await page.locator(".hand .card").count();
        await card.click(); // focus is now on this card
        const seat = page.locator(".seat.clickable").first();
        if (await seat.isVisible().catch(() => false)) {
          await seat.click();
          await card.focus(); // the case that broke: focus on the card, not the button
        }
        if (await use.isEnabled().catch(() => false)) {
          await page.keyboard.press("Enter");
          await expect(use).toBeHidden({ timeout: 3000 });
          expect(await page.locator(".hand .card").count()).toBeLessThan(before);
          enterUsed = true;
        } else await page.keyboard.press("Escape");
      }
    }
    await step(page, EN);
    await expect(page.locator(".game-over")).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 150_000, intervals: [100] });
  // (whether a turn with a playable card comes up is down to the deal; the next test
  // checks Enter deterministically)
  test.info().annotations.push({ type: "enter-in-game", description: String(enterUsed) });

  // By the end of the game every kind of effect has shown.
  const seen = await page.evaluate(() => [...(window as unknown as { __fx: Set<string> }).__fx]);
  for (const kind of ["banner", "flight", "line", "number"]) expect(seen, `saw a ${kind} effect`).toContain(kind);
  expect(errors).toEqual([]);
});

test("Enter confirms while the card you clicked still has focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?gallery=play_strike&lang=en"); // a real play-phase moment, nothing random
  await page.locator(".table-screen").waitFor();
  // Record presses of the main-action button (the gallery has no server to answer).
  await page.evaluate(() => {
    const w = window as unknown as { __main: number };
    w.__main = 0;
    document.addEventListener("click", (e) => (e.target as Element).closest('[data-shortcut="Enter"]') && w.__main++, true);
  });
  const strike = page.locator(".hand .card.clickable", { hasText: "Strike" }).first();
  await strike.click();
  await page.locator(".seat.clickable").first().click();
  await expect(page.getByRole("button", { name: "Use", exact: true })).toBeEnabled();
  await strike.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { __main: number }).__main)).toBe(1);
  await expect(strike).toHaveClass(/selected/); // the card wasn't "pressed" again
});

test("sounds play as the game happens, and the speaker button mutes them", async ({ browser }) => {
  const errors: string[] = [];
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" })).newPage();
  collectErrors(page, errors);
  const heard = () => page.evaluate(() => [...((window as unknown as { __sgsSounds?: string[] }).__sgsSounds ?? [])]);
  await startBotGame(page, "Alice", 4); // the clicks also unlock audio (browser rule)

  // Muted: a stretch of the game makes no sound. (Pick the hero first: while the hero
  // dialog is open the top bar can't be reached, and its countdown would tick unmuted.)
  await page.locator(".hero-card").first().click();
  await page.getByRole("button", { name: "Mute sounds" }).click();
  await page.evaluate(() => ((window as unknown as { __sgsSounds?: string[] }).__sgsSounds = []));
  for (let i = 0; i < 40; i++) {
    await step(page, EN);
    await page.waitForTimeout(100);
  }
  expect(await heard()).toEqual([]);

  // Unmuted: the rest of the game is heard, ending with the result.
  await page.getByRole("button", { name: "Turn sounds on" }).click();
  await expect(async () => {
    await step(page, EN);
    await expect(page.locator(".game-over")).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 150_000, intervals: [100] });
  const sounds = await heard();
  expect(sounds).toContain("card");
  expect(sounds).toContain("damage");
  expect(sounds.some((s) => s === "victory" || s === "defeat"), `result sound in ${sounds.join(",")}`).toBe(true);
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
