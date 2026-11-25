// The test room: bots fill the table, and the Test panel changes heroes, cards and HP
// mid-game. Also checks Zhou Yu's False Letter: he picks the card he hands over.
import { expect, test } from "@playwright/test";
import { EN, collectErrors, step } from "./helpers";

test("test room: switch to Zhou Yu, get a card, and False Letter lets you pick the card", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  collectErrors(page, errors);
  await page.goto("/?lang=en");
  await page.getByPlaceholder("e.g. Jason").fill("Tester");
  await page.getByRole("button", { name: "Create a room" }).click();
  await page.getByLabel("Test room").selectOption("on");
  await expect(page.locator(".sandbox-note")).toBeVisible();
  // No bots needed: the table fills itself.
  await page.getByRole("button", { name: "Start test game" }).click();

  // You're the Lord and go first: answer anything your random hero is asked, up to the play phase.
  const endPhase = page.locator(".action-bar.active .end-phase");
  await expect(async () => {
    await step(page, EN, { holdPlay: true });
    await expect(endPhase).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 30_000 });
  await expect(page.locator(".seat-slot")).toHaveCount(3);

  await page.getByRole("button", { name: "Test", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Test room" });
  await panel.locator('select[name="test-hero"]').selectOption("zhou_yu");
  await panel.getByRole("button", { name: "Switch hero" }).click();
  await expect(page.locator(".dock-self")).toContainText("Zhou Yu");
  await expect(page.locator(".log-panel")).toContainText("[Test] Tester becomes Zhou Yu");

  await panel.locator('select[name="test-card"]').selectOption("peach");
  await panel.locator('select[name="test-suit"]').selectOption("heart");
  await panel.getByRole("button", { name: "Give to hand" }).click();
  await expect(page.locator(".log-panel")).toContainText("[Test] Tester is given Peach ♥");
  await panel.locator('select[name="test-seat"]').selectOption("1");
  await panel.locator('input[name="test-hp"]').fill("2");
  await panel.getByRole("button", { name: "Set HP" }).click();
  await expect(page.locator(".log-panel")).toContainText("HP is set to 2");
  await panel.getByRole("button", { name: "Close" }).click();

  // The play request was refreshed: False Letter is offered right away.
  await page.getByRole("button", { name: /False Letter/ }).click();
  await page.locator(".seat.clickable").first().click();
  await page.getByRole("button", { name: "Use", exact: true }).click();
  // The (passive) bot names a suit; then *you* choose which card to hand over.
  const bar = page.locator(".action-bar.active");
  await expect(bar.locator(".action-title")).toContainText("named ♠ Spades");
  await page.locator('.hand button[aria-label^="Peach ♥"]').first().click();
  await bar.getByRole("button", { name: "Give", exact: true }).click();
  await expect(page.locator(".log-panel")).toContainText(/Tester gives Peach ♥\S+ to/);
  await expect(page.locator(".log-panel")).toContainText(/takes 1 damage from Tester/);

  expect(errors).toEqual([]);
});
