// Home and lobby: layout checks + screenshot baselines (desktop English, phone Chinese).
import { expect, test, type Page } from "@playwright/test";
import { settleFonts } from "./helpers";

const VIEWS = [
  { name: "desktop-en", lang: "en", size: { width: 1440, height: 900 }, labels: { name: "e.g. Jason", create: "Create a room", add: "Add bot" } },
  { name: "phone-zh", lang: "zh", size: { width: 390, height: 844 }, labels: { name: "例如：小明", create: "创建房间", add: "添加电脑" } },
] as const;

async function checkLayout(page: Page, phone: boolean) {
  // Every button and input is reachable: nothing sits on top of its centre.
  const blocked = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, input"))) {
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) out.push(`${el.textContent || el.getAttribute("placeholder")} covered`);
    }
    window.scrollTo(0, 0);
    return out;
  });
  expect(blocked).toEqual([]);
  if (phone) expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const view of VIEWS) {
  test(`home and lobby · ${view.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewportSize(view.size);
    await page.goto(`/?lang=${view.lang}`);
    await page.getByPlaceholder(view.labels.name).waitFor();
    await page.waitForLoadState("networkidle");
    await settleFonts(page);
    await checkLayout(page, view.name.startsWith("phone"));
    await expect(page).toHaveScreenshot(`home-${view.name}.png`, { fullPage: true });

    await page.getByPlaceholder(view.labels.name).fill(view.lang === "zh" ? "小明" : "Alice");
    await page.getByRole("button", { name: view.labels.create }).click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: view.labels.add }).click();
    await expect(page.locator(".members li")).toHaveCount(5);
    await checkLayout(page, view.name.startsWith("phone"));
    // the room code is random: mask it
    const mask = [page.locator(".room-title"), page.locator(".room-code"), page.locator(".invite-link")];
    await settleFonts(page);
    await expect(page).toHaveScreenshot(`lobby-${view.name}.png`, { fullPage: true, mask });
    expect(errors).toEqual([]);
  });
}
