// Big table moments, replayed in the animation lab (/?fx): no game needed, nothing random.
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

/** Record every killing-blow card ever shown, and the most on screen at once. */
async function watchBlows(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __blows: { seen: number; most: number } };
    w.__blows = { seen: 0, most: 0 };
    const known = new WeakSet<Element>();
    new MutationObserver(() => {
      const cards = document.querySelectorAll(".kill-card");
      cards.forEach((el) => {
        if (!known.has(el)) w.__blows.seen++;
        known.add(el);
      });
      w.__blows.most = Math.max(w.__blows.most, cards.length);
    }).observe(document, { subtree: true, childList: true });
  });
}
const blows = (page: Page) => page.evaluate(() => (window as unknown as { __blows: { seen: number; most: number } }).__blows);
const sounds = (page: Page) => page.evaluate(() => [...((window as unknown as { __sgsSounds?: string[] }).__sgsSounds ?? [])]);

async function openLab(page: Page, effect: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?fx=${effect}&lang=en`);
  await page.locator(".table-screen").waitFor();
}

test("killing blow: the killer's card slams the victim, who falls on impact", async ({ page }) => {
  await watchBlows(page);
  await openLab(page, "kill");
  const killer = await page.getByLabel("Killer / source").inputValue();
  const victim = await page.getByLabel("Victim / target").inputValue();
  const victimSeat = page.locator(`[data-seat="${victim}"]`);
  await page.getByRole("button", { name: /^Play/ }).click(); // (the click also unlocks audio)

  // The blow: a copy of the killer's own hero card, while the victim still looks alive.
  const card = page.locator(".kill-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".hero-face")).toHaveCount(1);
  const killerHero = await page.locator(`[data-seat="${killer}"] .hero-face`).getAttribute("class");
  expect(await card.locator(".hero-face").getAttribute("class")).toBe(killerHero);
  await expect(victimSeat).toHaveAttribute("data-fx-hold", "");
  await expect(victimSeat.locator(".seat")).toHaveClass(/dead/); // dead in the game already...
  await expect(victimSeat.locator(".death-stamp")).toBeHidden(); // ...but not shown until impact

  // Impact and after: the stamp lands, the gong sounds after the slam, the layer clears.
  await expect(victimSeat.locator(".death-stamp")).toBeVisible();
  await expect(victimSeat).not.toHaveAttribute("data-fx-hold");
  await expect(card).toHaveCount(0);
  const heard = await sounds(page);
  expect(heard.indexOf("slam"), heard.join(",")).toBeGreaterThanOrEqual(0);
  expect(heard.indexOf("death")).toBeGreaterThan(heard.indexOf("slam"));
  expect(await page.locator(".fx-layer > *").count()).toBe(0);
});

test("two deaths at once play one after the other", async ({ page }) => {
  await watchBlows(page);
  await openLab(page, "double");
  const second = page.locator(`[data-seat="${await page.getByLabel("Second victim").inputValue()}"]`);
  await page.getByRole("button", { name: /^Play/ }).click();
  await expect(page.locator(".kill-card")).toBeVisible();
  // the second victim waits its turn, still looking alive
  await expect(second).toHaveAttribute("data-fx-hold", "");
  await expect(second.locator(".death-stamp")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".kill-card")).toHaveCount(0);
  expect(await blows(page)).toEqual({ seen: 2, most: 1 });
});

test("slow motion stretches the blow", async ({ page }) => {
  await openLab(page, "kill");
  await page.getByRole("button", { name: "0.25×" }).click();
  await page.getByRole("button", { name: /^Play/ }).click();
  await expect(page.locator(".kill-card")).toBeVisible();
  // at 1× the whole blow is over in about 2 s; at 0.25× it is still in the air
  await page.waitForTimeout(2500);
  await expect(page.locator(".kill-card")).toBeVisible();
});

test("reduced motion: no blow, the victim falls at once", async ({ browser }) => {
  const page = await (await browser.newContext({ reducedMotion: "reduce" })).newPage();
  await watchBlows(page);
  await openLab(page, "kill");
  const victim = page.locator(`[data-seat="${await page.getByLabel("Victim / target").inputValue()}"]`);
  await page.getByRole("button", { name: /^Play/ }).click();
  await expect(victim.locator(".death-stamp")).toBeVisible();
  await expect(victim).not.toHaveAttribute("data-fx-hold");
  expect((await blows(page)).seen).toBe(0);
  expect(await sounds(page)).toContain("death");
});
