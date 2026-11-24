// Whole games through the real UI against the live server (hard bots fill the seats).
import { expect, test } from "@playwright/test";
import { collectErrors, EN, step, ZH } from "./helpers";

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

  await expect(async () => {
    await step(host, EN);
    await step(guest, EN);
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

  await expect(async () => {
    await step(page, ZH);
    await expect(page.locator(".game-over")).toBeVisible({ timeout: 200 });
  }).toPass({ timeout: 150_000, intervals: [100] });
  await expect(page.locator(".game-over")).toContainText(/胜利|失败/);

  await page.getByRole("button", { name: "查看牌桌" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator(".topbar")).toContainText("Three Kingdoms Table");
  await expect(page.locator(".log")).toContainText("Game over");
  expect(errors).toEqual([]);
});
