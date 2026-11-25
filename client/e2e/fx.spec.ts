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

test("kill streak: a banner after the blow, fiercer the more kills, with its fanfare", async ({ page }) => {
  await openLab(page, "streak");
  for (const [kills, title] of [
    ["2", "Double Kill"],
    ["7", "Unstoppable"],
  ] as const) {
    await page.getByLabel("Kills", { exact: true }).selectOption(kills);
    await page.getByRole("button", { name: /^Play/ }).click(); // (the click also unlocks audio)
    const banner = page.locator(".kill-streak");
    await expect(page.locator(".kill-card")).toBeVisible(); // the killing blow comes first...
    await expect(banner).toBeVisible({ timeout: 5000 }); // ...then the streak
    await expect(page.locator(".kill-card")).toHaveCount(0);
    await expect(banner.locator(".streak-title")).toHaveText(title);
    await expect(banner).toHaveAttribute("data-level", kills);
    await expect(banner.locator("[class*=mark]")).toHaveCount(Number(kills) + 1); // (the marks row + one mark per kill)
    await expect(banner).toHaveCount(0, { timeout: 6000 });
    expect(await sounds(page)).toContain(`streak${kills}`);
  }
});

test("kill streak in Chinese", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?fx=streak&lang=zh");
  await page.locator(".table-screen").waitFor();
  await page.getByLabel("Kills", { exact: true }).selectOption("3");
  await page.getByRole("button", { name: /^Play/ }).click();
  await expect(page.locator(".kill-streak .streak-title")).toHaveText("三杀", { timeout: 5000 });
});

test("judgment: the card turns over the judged seat and a seal stamps the outcome", async ({ page }) => {
  await openLab(page, "judge");
  const victim = await page.getByLabel("Victim / target").inputValue();
  const seatBox = (await page.locator(`[data-seat="${victim}"] .hero-face`).boundingBox())!;
  for (const [effect, word, good, sound] of [
    ["judge", "Hit!", "false", "judgeBad"], // Indulgence hits: bad news
    ["judgeGood", "Hit!", "true", "judgeGood"], // Eight Trigrams hits: good news
    ["judgeMiss", "Miss", "true", "judgeGood"], // Lightning misses: good news
  ] as const) {
    await page.getByLabel("Effect").selectOption(effect);
    await page.getByRole("button", { name: /^Play/ }).click(); // (the click also unlocks audio)
    const fx = page.locator(".judgment-fx"); // (a 0×0 anchor at the seat's centre)
    await expect(fx).toHaveCount(1);
    await expect(fx).toHaveAttribute("data-good", good);
    await expect(fx.locator(".judgment-seal")).toContainText(word);
    const card = fx.locator(".card"); // a copy of the judgment card...
    await expect(card).toHaveCount(1);
    const box = (await card.boundingBox())!; // ...over the judged player's hero card
    expect(Math.abs(box.x + box.width / 2 - (seatBox.x + seatBox.width / 2))).toBeLessThan(8);
    await expect(fx).toHaveCount(0, { timeout: 4000 });
    expect(await sounds(page)).toContain(sound);
  }
});

test("judgment before the death it causes (Lightning)", async ({ page }) => {
  await watchBlows(page);
  await openLab(page, "judgeKill");
  const victim = page.locator(`[data-seat="${await page.getByLabel("Victim / target").inputValue()}"]`);
  await page.getByRole("button", { name: /^Play/ }).click();
  await expect(page.locator(".judgment-fx")).toHaveCount(1);
  await expect(victim.locator(".death-stamp")).toBeHidden(); // the fall waits for the judgment
  await expect(page.locator(".judgment-fx")).toHaveCount(0, { timeout: 4000 });
  await expect(victim.locator(".death-stamp")).toBeVisible({ timeout: 6000 });
  expect((await blows(page)).seen).toBe(0); // (no killer: only the impact)
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
