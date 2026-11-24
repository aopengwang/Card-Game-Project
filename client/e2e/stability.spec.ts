// The table must not move while you play: no element of the layout frame may shift or
// resize as prompts, hands, plaques and the log change. Plays real games at common
// desktop window sizes and samples the layout after every action.
import { expect, test } from "@playwright/test";
import { collectErrors, EN, startBotGame, step } from "./helpers";

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 1366, height: 650 }, // laptop with browser toolbars
  { width: 1280, height: 720 },
  { width: 2560, height: 1400 }, // big monitor: Auto interface size zooms the whole table
];

/** Everything that should stay put, rounded to whole pixels. */
function frame() {
  const box = (el: Element | null) => {
    if (!el) return "missing";
    const r = el.getBoundingClientRect();
    return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  };
  const out: Record<string, string> = {
    scroll: `${Math.round(window.scrollX)},${Math.round(window.scrollY)}`,
    topbar: box(document.querySelector(".topbar")),
    arena: box(document.querySelector(".arena")),
    dock: box(document.querySelector(".dock")),
    bar: box(document.querySelector(".action-bar")),
    hand: box(document.querySelector(".hand")),
    self: box(document.querySelector(".dock-self")),
    center: box(document.querySelector(".center")),
  };
  // Scroll offsets of every scrollable ancestor of the table (focus can scroll hidden overflow).
  for (const sel of [".table-screen", ".table-main", ".arena", ".dock"]) {
    const el = document.querySelector(sel);
    if (el) out[`${sel}-scroll`] = `${el.scrollLeft},${el.scrollTop}`;
  }
  document.querySelectorAll(".seat-slot").forEach((el, i) => (out[`seat${i}`] = box(el)));
  return out;
}

for (const size of SIZES) {
  test(`layout stays still during a game · ${size.width}x${size.height}`, async ({ browser }) => {
    const errors: string[] = [];
    const page = await (await browser.newContext({ viewport: size, locale: "en-US" })).newPage();
    collectErrors(page, errors);
    await startBotGame(page, "Alice", 6);
    await page.locator(".table-screen").waitFor();

    let first: Record<string, string> | null = null;
    const moves = new Set<string>();
    await expect(async () => {
      await step(page, EN);
      // Only judge the table itself (dialogs float over it).
      if (!(await page.locator(".overlay").isVisible().catch(() => false))) {
        const now = await page.evaluate(frame);
        first ??= now;
        for (const k of Object.keys(now)) if (now[k] !== first[k]) moves.add(`${k}: ${first[k]} -> ${now[k]}`);
      }
      await expect(page.locator(".game-over")).toBeVisible({ timeout: 200 });
    }).toPass({ timeout: 150_000, intervals: [100] });

    expect([...moves].slice(0, 30)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
