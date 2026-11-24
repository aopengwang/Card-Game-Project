// Every captured game moment, rendered by the real UI: layout checks + screenshot baselines.
// Update baselines after an intended visual change: npm run e2e -- --update-snapshots
import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { settleFonts } from "./helpers";

// A fixture renders in a second or two: fail fast rather than wait out the 3-minute
// default meant for the full-game tests.
test.describe.configure({ timeout: 60_000 });

const FIXTURES = readdirSync(new URL("../src/dev/fixtures", import.meta.url))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const VIEWS = [
  { name: "desktop-en", lang: "en", size: { width: 1440, height: 900 } },
  { name: "phone-zh", lang: "zh", size: { width: 390, height: 844 } },
] as const;

/** Clickable things whose centre is covered by something else (the "click swallowed" bug). */
function blockedClickables(): string[] {
  const overlay = document.querySelector(".overlay");
  const scope: ParentNode = overlay ?? document;
  const selector = ".card.clickable, .seat.clickable, .action-bar button, .hero-card, .lang-toggle";
  const blocked: string[] = [];
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>(selector))) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !(hit === el || el.contains(hit))) {
      blocked.push(`${el.className.trim()} "${(el.textContent ?? "").trim().slice(0, 30)}" covered by ${hit?.className ?? "nothing"}`);
    }
  }
  window.scrollTo(0, 0);
  return blocked;
}

test("fixtures exist", () => {
  expect(FIXTURES.length).toBeGreaterThanOrEqual(10);
});

for (const id of FIXTURES) {
  for (const view of VIEWS) {
    test(`${id} · ${view.name}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setViewportSize(view.size);
      // Freeze the clock so countdown timers render identically on every run (no masking).
      await page.clock.setFixedTime(new Date("2026-01-01T12:00:00Z"));
      await page.goto(`/?gallery=${id}&lang=${view.lang}`);
      await page.locator(".table-screen").waitFor();
      await page.waitForLoadState("networkidle");
      await settleFonts(page);

      expect(await page.evaluate(blockedClickables)).toEqual([]);
      // Every card on screen is a playing card: 5:7, whatever its size or place.
      const offRatio = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>(".card"))
          .map((el) => ({ el, w: el.offsetWidth, h: el.offsetHeight }))
          .filter(({ w, h }) => w > 0 && Math.abs(h / w - 1.4) > 0.015)
          .map(({ el, w, h }) => `${el.getAttribute("aria-label")} ${w}x${h}`),
      );
      expect(offRatio, "cards not at 5:7").toEqual([]);
      if (view.name.startsWith("desktop")) {
        // The table is pinned to the window: content changes must never resize the page
        // (a growing page made the whole table jump up and down mid-game).
        const fit = await page.evaluate(() => ({
          table: Math.round(document.querySelector(".table-screen")!.getBoundingClientRect().height),
          page: document.documentElement.scrollHeight,
          window: window.innerHeight,
          bar: Math.round(document.querySelector(".action-bar")!.getBoundingClientRect().height),
        }));
        expect(fit).toEqual({ table: view.size.height, page: view.size.height, window: view.size.height, bar: 108 });
        // ...and every opponent's plaque fits on the table (none cut off by the top bar or dock).
        const clipped = await page.evaluate(() => {
          const table = document.querySelector(".table-main")!.getBoundingClientRect();
          return Array.from(document.querySelectorAll<HTMLElement>(".seat-slot"))
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.top < table.top - 1 || r.bottom > table.bottom + 1)
            .map(({ el, r }) => `${el.textContent?.slice(0, 20)} ${Math.round(r.top)}-${Math.round(r.bottom)}`);
        });
        expect(clipped).toEqual([]);
      }
      if (view.name.startsWith("phone")) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, "page scrolls sideways on a phone").toBeLessThanOrEqual(0);
      }
      await settleFonts(page); // (the clickable check above scrolled things into view)
      await expect(page).toHaveScreenshot(`${id}-${view.name}.png`, { fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}

for (const lang of ["en", "zh"] as const) {
  test(`component showcase · ${lang}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date("2026-01-01T12:00:00Z"));
    await page.goto(`/?gallery&lang=${lang}`);
    await page.getByText("Seat plaques").waitFor();
    await page.waitForLoadState("networkidle");
    // Web fonts arrive in slices, each fetched once its characters are on screen. Scroll
    // the whole (tall) page first so every slice is in before the full-page capture.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState("networkidle");
    await settleFonts(page);
    await expect(page).toHaveScreenshot(`showcase-${lang}.png`, { fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("hero cards: 5:7 art, skills only on hover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?gallery=play_strike&lang=en");
  await page.locator(".table-screen").waitFor();
  const faces = page.locator(".seat .hero-face");
  // every hero card (opponents and yours) is a 5:7 card
  for (const r of await faces.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height / el.getBoundingClientRect().width))) {
    expect(Math.abs(r - 1.4)).toBeLessThan(0.02);
  }
  // skill names aren't printed on the seat...
  const seat = page.locator(".seat-slot").first();
  const tip = page.getByRole("tooltip");
  await expect(tip).toHaveCount(0);
  // ...they show when you hover its hero card, with the full rules
  await seat.locator(".hero-face").hover();
  await expect(tip).toBeVisible();
  expect(((await tip.textContent()) ?? "").length).toBeGreaterThan(30);
  const firstSkill = ((await tip.locator("b, strong, [class*=title]").first().textContent()) ?? "").trim();
  expect(firstSkill.length).toBeGreaterThan(0);
  expect(await seat.locator(".seat").textContent()).not.toContain(firstSkill);
});

test("gallery index lists every fixture in both languages", async ({ page }) => {
  await page.goto("/?gallery");
  for (const id of FIXTURES) {
    await expect(page.locator(`a[href="?gallery=${id}&lang=en"]`)).toHaveCount(1);
    await expect(page.locator(`a[href="?gallery=${id}&lang=zh"]`)).toHaveCount(1);
  }
});
