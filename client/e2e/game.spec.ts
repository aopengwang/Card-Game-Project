// Whole games through the real UI against the live server (hard bots fill the seats).
import { expect, test, type Page } from "@playwright/test";

/** Answer whatever the game asks, the way a cautious-but-legal player would. */
async function step(page: Page, labels: { endPhase: string; pass: string[]; confirm: string; use: string }) {
  const bar = page.locator(".action-bar.active");
  if (await page.locator(".hero-card").first().isVisible().catch(() => false)) {
    await page.locator(".hero-card").first().click();
    return;
  }
  if (!(await bar.isVisible().catch(() => false))) return;
  const title = (await page.locator(".action-title").textContent().catch(() => "")) ?? "";
  const endPhase = page.getByRole("button", { name: labels.endPhase, exact: true });
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
  const any = page.locator(".action-buttons button, .choice-cards .card").first();
  if (await any.isVisible().catch(() => false)) await any.click();
  void title;
}

function collectErrors(page: Page, into: string[]) {
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

test("English: desktop host and phone guest play a full game", async ({ browser }) => {
  const errors: string[] = [];
  const host = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" })).newPage();
  collectErrors(host, errors);
  await host.goto("/");
  await host.getByPlaceholder("e.g. Jason").fill("Alice");
  await host.getByRole("button", { name: "Create a room" }).click();
  const heading = host.getByRole("heading", { name: /^Room [A-Z]{5}$/ });
  await heading.waitFor();
  const code = ((await heading.textContent()) ?? "").slice(5);

  const guest = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" })).newPage();
  collectErrors(guest, errors);
  await guest.goto(`/?room=${code}`);
  await guest.getByPlaceholder("e.g. Jason").fill("Bob");
  await guest.getByRole("button", { name: "Join" }).click();
  for (let i = 0; i < 3; i++) await host.getByRole("button", { name: "Add bot" }).click();
  await expect(host.locator(".members li")).toHaveCount(5);
  await host.getByRole("button", { name: "Start game" }).click();

  const labels = { endPhase: "End play phase", pass: ["Don't play", "No", "None"], confirm: "Confirm", use: "Use" };
  await expect(async () => {
    await step(host, labels);
    await step(guest, labels);
    await expect(host.locator(".game-over")).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 150_000, intervals: [100] });
  expect(errors).toEqual([]);
});

test("中文: a full game in Chinese, then switch to English live", async ({ browser }) => {
  const errors: string[] = [];
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" })).newPage();
  collectErrors(page, errors);
  await page.goto("/");
  await page.getByPlaceholder("例如：小明").fill("小明");
  await page.getByRole("button", { name: "创建房间" }).click();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "添加电脑" }).click();
  await expect(page.locator(".members li")).toHaveCount(5);
  await expect(page.locator(".members")).toContainText("电脑1");
  await page.getByRole("button", { name: "开始游戏" }).click();

  const labels = { endPhase: "结束出牌", pass: ["不出", "否", "不选"], confirm: "确定", use: "使用" };
  await expect(async () => {
    await step(page, labels);
    await expect(page.locator(".game-over")).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 150_000, intervals: [100] });
  await expect(page.locator(".game-over")).toContainText(/胜利|失败/);

  await page.getByRole("button", { name: "查看牌桌" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator(".topbar")).toContainText("Three Kingdoms Table");
  await expect(page.locator(".log")).toContainText("Game over");
  expect(errors).toEqual([]);
});
