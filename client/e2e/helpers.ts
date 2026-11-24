// Shared by the full-game browser tests.
import type { Page } from "@playwright/test";

export type Labels = { endPhase: string; pass: string[]; confirm: string; use: string };
export const EN: Labels = { endPhase: "End play phase", pass: ["Don't play", "No", "None"], confirm: "Confirm", use: "Use" };
export const ZH: Labels = { endPhase: "结束出牌", pass: ["不出", "否", "不选"], confirm: "确定", use: "使用" };

/**
 * Answer whatever the game asks, the way a cautious-but-legal player would.
 * `holdPlay`: answer everything except your own play phase, which is left waiting (for
 * tests that want to act in it themselves).
 */
export async function step(page: Page, labels: Labels, { holdPlay = false } = {}) {
  const bar = page.locator(".action-bar.active");
  if (await page.locator(".hero-card").first().isVisible().catch(() => false)) {
    await page.locator(".hero-card").first().click();
    return;
  }
  if (!(await bar.isVisible().catch(() => false))) return;
  const endPhase = page.getByRole("button", { name: labels.endPhase, exact: true });
  if (holdPlay && (await page.locator(".action-bar.active .end-phase").count())) return;
  if (await endPhase.isVisible().catch(() => false)) {
    // Our turn: try the first playable card on the first legal target, else end the phase.
    const card = page.locator(".hand .card.clickable").first();
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      const seat = page.locator(".seat.clickable").first();
      if (await seat.isVisible().catch(() => false)) await seat.click();
      const use = page.getByRole("button", { name: labels.use, exact: true });
      if (await use.isEnabled().catch(() => false)) {
        await use.click();
        return;
      }
    }
    await endPhase.click();
    return;
  }
  for (const name of labels.pass) {
    const b = page.getByRole("button", { name, exact: true });
    if (await b.isVisible().catch(() => false)) {
      await b.click();
      return;
    }
  }
  const confirm = page.getByRole("button", { name: labels.confirm, exact: true });
  if (await confirm.isVisible().catch(() => false)) {
    const cards = page.locator(".hand .card.clickable");
    for (let i = 0; i < (await cards.count()) && !(await confirm.isEnabled()); i++) await cards.nth(i).click();
    const seat = page.locator(".seat.clickable").first();
    if (!(await confirm.isEnabled()) && (await seat.isVisible().catch(() => false))) await seat.click();
    if (await confirm.isEnabled()) await confirm.click();
    return;
  }
  // Last resort: the first option on offer, but never the play phase's own buttons (the
  // play phase can begin between the checks above and this click).
  if (await page.locator(".action-bar.active .end-phase").count()) return;
  const any = page.locator(".action-buttons button, .choice-cards .card").first();
  if (await any.isVisible().catch(() => false)) await any.click();
}

export function collectErrors(page: Page, into: string[]) {
  page.on("pageerror", (e) => into.push(String(e)));
  page.on("console", (m) => {
    // Resource failures are judged by URL below; anything else logged as an error counts.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) into.push(m.text());
  });
  page.on("requestfailed", (r) => {
    const url = new URL(r.url());
    // Our own server must never fail. Third-party hosts (Google Fonts) can blip: the game
    // falls back to system fonts, so that's not a game failure.
    if (url.origin === new URL(page.url()).origin) into.push(`request failed: ${r.url()} ${r.failure()?.errorText}`);
  });
  page.on("response", (r) => {
    const url = new URL(r.url());
    if (r.status() >= 400 && url.origin === new URL(page.url()).origin && !url.pathname.startsWith("/art/")) {
      into.push(`HTTP ${r.status()} ${r.url()}`); // /art/ 404s are expected (art slots without files)
    }
  });
}

/**
 * Wait until every character on the page is drawn in its real font. Web fonts (Chinese
 * above all) arrive in slices fetched per character, and document.fonts.ready can settle
 * before a slice is even requested, so a screenshot may catch the fallback font. Ask for
 * exactly the page's characters in each of the design's fonts, then wait.
 */
export async function settleFonts(page: Page) {
  await page.evaluate(async () => {
    const text = document.body.innerText + (document.querySelector("[role=dialog]") as HTMLElement | null)?.innerText;
    const css = getComputedStyle(document.documentElement);
    const families = ["--ik-font-brush", "--ik-font-display", "--ik-font-body"].map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
    const unique = [...new Set(text)].join("");
    await Promise.all(families.flatMap((f) => ["400", "600", "700"].map((w) => document.fonts.load(`${w} 24px ${f}`, unique).catch(() => []))));
    await document.fonts.ready;
  });
}

/** Create a room as `name`, fill it with hard bots up to `players`, start the game. */
export async function startBotGame(page: Page, name: string, players: number) {
  await page.goto("/?lang=en");
  await page.getByPlaceholder("e.g. Jason").fill(name);
  await page.getByRole("button", { name: "Create a room" }).click();
  for (let i = 1; i < players; i++) await page.getByRole("button", { name: "Add bot" }).click();
  await page.locator(".members li").nth(players - 1).waitFor();
  await page.getByRole("button", { name: "Start game" }).click();
}
