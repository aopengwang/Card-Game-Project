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

  // Tooltips sit next to what they describe (they're drawn outside the zoomed app).
  const chip = page.locator(".seat [tabindex='0']").first();
  await chip.hover();
  const tip = page.locator("[data-radix-popper-content-wrapper]");
  await tip.waitFor();
  const [a, b] = [await chip.boundingBox(), await tip.boundingBox()];
  const gap = Math.max(0, b!.y - (a!.y + a!.height), a!.y - (b!.y + b!.height));
  expect(gap, "tooltip touches its chip").toBeLessThan(16);
  expect(Math.abs(b!.x + b!.width / 2 - (a!.x + a!.width / 2)), "tooltip centred on its chip").toBeLessThan(b!.width / 2 + 20);

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

  // Start, pick a hero, and wait for our play phase: its timer starts from 45.
  for (let i = 0; i < 2; i++) await host.getByRole("button", { name: "Add bot" }).click();
  await host.getByRole("button", { name: "Start game" }).click();
  const endPhase = host.getByRole("button", { name: EN.endPhase, exact: true });
  await expect(async () => {
    // keep both players answering (heroes, responses, discards) until the host's play phase
    if (!(await endPhase.isVisible().catch(() => false))) await step(host, { ...EN, endPhase: "\u0000never" });
    await step(guest, EN);
    await expect(endPhase).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 90_000, intervals: [100] });
  const secs = Number(await host.locator(".action-bar.active [role=timer]").textContent());
  expect(secs).toBeGreaterThan(35);
  expect(secs).toBeLessThanOrEqual(45);
  expect(errors).toEqual([]);
});
