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

test("test room: play the bots' turns yourself, from your own seat", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  collectErrors(page, errors);
  await page.goto("/?lang=en");
  await page.getByPlaceholder("e.g. Jason").fill("Tester");
  await page.getByRole("button", { name: "Create a room" }).click();
  await page.getByLabel("Test room").selectOption("on");
  await page.getByRole("button", { name: "Start test game" }).click();
  const endPhase = page.locator(".action-bar.active .end-phase");
  await expect(async () => {
    await step(page, EN, { holdPlay: true });
    await expect(endPhase).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 30_000 });
  const mySeat = await page.locator(".dock-self").getAttribute("data-seat");

  await page.getByRole("button", { name: "Test", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Test room" });
  const control = panel.getByLabel(/Play the bots' turns yourself/);
  await control.click();
  await expect(control).toBeChecked(); // (once the server agrees)
  await expect(panel.locator('input[name="test-passive"]')).toBeDisabled();
  await panel.getByRole("button", { name: "Close" }).click();

  // Finish your own turn; the next bot's play phase comes to you.
  const tag = page.locator(".acting-tag");
  await expect(async () => {
    if (!(await tag.isVisible()) || !(await endPhase.isVisible())) await step(page, EN);
    await expect(tag).toBeVisible({ timeout: 300 });
    await expect(endPhase).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 60_000 });
  await expect(tag).toContainText(/^Playing as Bot \d/);
  // Your table didn't turn: you're still at the bottom.
  await expect(page.locator(".dock-self")).toHaveAttribute("data-seat", mySeat!);
  // The dock shows the bot's hand: as many cards as its seat says it holds.
  const botName = ((await tag.textContent()) ?? "").match(/Bot \d/)![0];
  const botSlot = page.locator(".seat-slot", { hasText: botName });
  const count = Number(await botSlot.locator('[aria-label^="Cards in hand"]').textContent());
  await expect(page.locator(".hand.acting .card")).toHaveCount(count);
  // End the bot's play phase for it: the game moves on.
  await endPhase.click();
  await expect(page.locator(".hand.acting .card").first().or(page.locator(".hand:not(.acting)"))).toBeVisible();
  await expect(page.locator(".log-panel")).toContainText(new RegExp(`${botName} (discards|draws)|Turn \\d+:`));
  expect(errors).toEqual([]);
});

test("test room: Fire Attack holds the shown card up for everyone, and says when you have no card of its suit", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  collectErrors(page, errors);
  await page.goto("/?lang=en");
  await page.getByPlaceholder("e.g. Jason").fill("Tester");
  await page.getByRole("button", { name: "Create a room" }).click();
  await page.getByLabel("Battle expansion").selectOption("on");
  await page.getByLabel("Test room").selectOption("on");
  await page.getByRole("button", { name: "Start test game" }).click();
  const endPhase = page.locator(".action-bar.active .end-phase");
  await expect(async () => {
    await step(page, EN, { holdPlay: true });
    await expect(endPhase).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 30_000 });

  await page.getByRole("button", { name: "Test", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Test room" });
  await panel.locator('select[name="test-card"]').selectOption("fire_attack");
  await panel.getByRole("button", { name: "Give to hand" }).click();
  await expect(page.locator(".log-panel")).toContainText("[Test] Tester is given Fire Attack");
  await panel.getByRole("button", { name: "Close" }).click();

  await page.locator('.hand button[aria-label^="Fire Attack"]').first().click();
  await page.locator(".seat.clickable").first().click();
  await page.getByRole("button", { name: "Use", exact: true }).click();
  const reveal = page.locator(".card-reveal");
  // (holding a Nullify, you're first asked whether to cancel your own Fire Attack: no)
  const nullify = page.locator(".action-bar.active .action-title", { hasText: /^Nullify Fire Attack/ });
  await expect(reveal.or(nullify)).toBeVisible();
  if (await nullify.isVisible()) await page.getByRole("button", { name: "Don't play", exact: true }).click();
  await expect(reveal.locator(".reveal-title")).toContainText("shows a card (Fire Attack)");
  await expect(reveal.locator(".card")).toHaveCount(1);
  // Either you hold a card of that suit (and are asked whether to discard it), or you're told you don't.
  const note = reveal.locator(".reveal-note");
  const ask = page.locator(".action-bar.active .action-title", { hasText: "Fire Attack: discard" });
  await expect(note.or(ask)).toBeVisible();
  if (await ask.isVisible()) {
    await expect(note).toHaveCount(0);
    await page.locator(".action-bar.active").getByRole("button", { name: "None" }).click();
  } else {
    await expect(note).toContainText(/You have no . \w+ card: your Fire Attack does nothing\./);
  }
  await expect(reveal).toHaveCount(0, { timeout: 6000 });
  expect(errors).toEqual([]);
});

test("test room: the Chairman's chill tokens show on the seat and Chill Guy spends them", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  collectErrors(page, errors);
  await page.goto("/?lang=en");
  await page.getByPlaceholder("e.g. Jason").fill("Tester");
  await page.getByRole("button", { name: "Create a room" }).click();
  await page.getByLabel("Test room").selectOption("on");
  await page.getByRole("button", { name: "Start test game" }).click();
  const endPhase = page.locator(".action-bar.active .end-phase");
  await expect(async () => {
    await step(page, EN, { holdPlay: true });
    await expect(endPhase).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 30_000 });

  await page.getByRole("button", { name: "Test", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Test room" });
  await panel.locator('select[name="test-hero"]').selectOption("chairman");
  await panel.getByRole("button", { name: "Switch hero" }).click();
  await expect(page.locator(".dock-self")).toContainText("The Chairman");
  await panel.locator('input[name="test-tokens"]').fill("2");
  await panel.getByRole("button", { name: "Set tokens" }).click();
  const chill = page.locator('.dock-self .token[data-token="chill"]');
  await expect(chill).toHaveAttribute("data-count", "2");
  await panel.getByRole("button", { name: "Close" }).click();

  // Chill Guy: one token for the pick of the top 2 cards.
  await page.getByRole("button", { name: /Chill Guy/ }).click();
  await page.getByRole("button", { name: "Use", exact: true }).click();
  const bar = page.locator(".action-bar.active");
  await expect(bar.locator(".action-title")).toContainText("Chill Guy: keep one of the top 2 cards");
  await expect(bar.locator(".choice-cards .card")).toHaveCount(2);
  await bar.locator(".choice-cards .card").first().click();
  await expect(chill).toHaveAttribute("data-count", "1");
  await expect(page.locator(".log-panel")).toContainText("Tester loses Chill tokens (1)");

  // The Lord's What's up Beijing!: shows the hand, and a marker until the next turn.
  await page.getByRole("button", { name: /What's up Beijing/ }).click();
  await page.getByRole("button", { name: "Use", exact: true }).click();
  await expect(page.locator('.dock-self .token[data-token="beijing"]')).toBeVisible();
  await expect(page.locator(".log-panel")).toContainText("Tester shows their hand");
  // ...held up in the middle of the table for everyone, for a few seconds
  const reveal = page.locator(".card-reveal");
  await expect(reveal.locator(".reveal-title")).toContainText("shows their hand (What's up Beijing!)");
  const handSize = await page.locator(".hand .card").count();
  await expect(reveal.locator(".card")).toHaveCount(handSize);
  await expect(reveal).toHaveCount(0, { timeout: 6000 });
  expect(errors).toEqual([]);
});
