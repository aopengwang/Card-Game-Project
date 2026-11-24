// Settings: interface size (whole-app zoom) and the host's game settings.
import { expect, test, type Page } from "@playwright/test";
import { collectErrors, EN, step } from "./helpers";

/** Everything that must hold at any interface size. */
async function checkFits(page: Page, height: number) {
  const r = await page.evaluate(() => ({
    table: Math.round(document.querySelector(".table-screen")!.getBoundingClientRect().height),
    page: document.documentElement.scrollHeight,
  }));
  expect(r, "the table fills exactly one window, no page scroll").toEqual({ table: height, page: height });
  // nothing covers a clickable thing (same check as the gallery)
  const blocked = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(".card.clickable, .seat.clickable, .action-bar button"))) {
      const b = el.getBoundingClientRect();
      if (!b.width) continue;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) out.push(el.className);
    }
    return out;
  });
  expect(blocked).toEqual([]);
}

test("interface size: scales everything, still fits the window, and is remembered", async ({ page }) => {
  const errors: string[] = [];
  collectErrors(page, errors);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?gallery=play_strike&lang=en");
  await page.locator(".table-screen").waitFor();
  const cardWidth = () => page.locator(".hand .card").first().evaluate((el) => el.getBoundingClientRect().width);
  const before = await cardWidth();

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "150%" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim())).toBe("1.5");
  expect(await cardWidth()).toBeGreaterThan(before * 1.15); // the hand got visibly bigger
  await checkFits(page, 900);

  // Tooltips sit right next to what they describe (they're drawn outside the zoomed app,
  // so a wrong zoom would push them away). Here: a hero card's skills, shown beside it.
  const card = page.locator(".seat-slot .hero-face").first();
  await card.hover();
  const tip = page.locator("[data-radix-popper-content-wrapper]");
  await tip.waitFor();
  const [a, b] = [(await card.boundingBox())!, (await tip.boundingBox())!];
  const gapX = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gapY = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  expect(Math.max(gapX, gapY), "tooltip touches its hero card").toBeLessThan(16);
  expect(Math.min(gapX, gapY), "tooltip is beside the card, not off diagonally").toBe(0);

  await page.reload();
  await page.locator(".table-screen").waitFor();
  expect(await page.evaluate(() => localStorage.getItem("sgs.uiScale"))).toBe("1.5");
  await checkFits(page, 900);
  expect(errors).toEqual([]);
});

test("interface size: Auto makes a big monitor's table bigger", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1400 });
  await page.goto("/?gallery=eight_players&lang=en");
  await page.locator(".table-screen").waitFor();
  const scale = Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")));
  expect(scale).toBeGreaterThanOrEqual(1.5);
  await checkFits(page, 1400);
});

test("host sets the game's timers; everyone sees them; the game uses them", async ({ browser }) => {
  const errors: string[] = [];
  const host = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  collectErrors(host, errors);
  await host.goto("/?lang=en");
  await host.getByPlaceholder("e.g. Jason").fill("Alice");
  await host.getByRole("button", { name: "Create a room" }).click();
  const heading = host.getByRole("heading", { name: /^Room [A-Z]{5}$/ });
  await heading.waitFor();
  const code = ((await heading.textContent()) ?? "").slice(5);

  const guest = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  collectErrors(guest, errors);
  await guest.goto(`/?room=${code}&lang=en`);
  await guest.getByPlaceholder("e.g. Jason").fill("Bob");
  await guest.getByRole("button", { name: "Join" }).click();

  await host.getByLabel("Turn time").selectOption("45");
  await host.getByLabel("Time to respond").selectOption("10");
  await expect(guest.locator(".game-settings")).toContainText("45s");
  await expect(guest.locator(".game-settings")).toContainText("10s");
  await expect(guest.locator(".game-settings select")).toHaveCount(0); // read-only for guests

  await host.getByLabel("Hero pick & discard").selectOption("30");
  await expect(guest.locator(".game-settings")).toContainText("30s");

  // The game uses them. Every player's first prompt is the hero pick: 30 seconds.
  for (let i = 0; i < 2; i++) await host.getByRole("button", { name: "Add bot" }).click();
  await host.getByRole("button", { name: "Start game" }).click();
  const timer = host.locator(".action-bar.active [role=timer]");
  await expect(async () => {
    await step(guest, EN); // the guest keeps the game moving (it may pick first)
    await expect(host.locator(".hero-card").first()).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 60_000, intervals: [100] });
  const heroSecs = Number(await timer.textContent());
  expect(heroSecs).toBeGreaterThan(20);
  expect(heroSecs).toBeLessThanOrEqual(30);
  await host.locator(".hero-card").first().click();

  // The host's next prompt, whatever it is, runs on its own timer: 45s for the play
  // phase, 30s for a discard, 10s for a response.
  let checked = "";
  await expect(async () => {
    await step(guest, EN);
    if (!(await host.locator(".action-bar.active").isVisible().catch(() => false))) throw new Error("waiting for the host's turn to answer");
    const secs = Number(await timer.textContent());
    const title = (await host.locator(".action-title").textContent()) ?? "";
    const play = (await host.locator(".action-bar.active .end-phase").count()) > 0;
    const limit = play ? 45 : /discard/i.test(title) ? 30 : 10;
    expect(secs, `"${title}"`).toBeLessThanOrEqual(limit);
    expect(secs, `"${title}"`).toBeGreaterThan(limit - 10);
    checked = title;
  }).toPass({ timeout: 90_000, intervals: [100] });
  expect(checked).not.toBe("");
  expect(errors).toEqual([]);
});
