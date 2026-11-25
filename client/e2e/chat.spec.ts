// Room passwords and chat, with two real players (two browser contexts).
import { expect, test, type Page } from "@playwright/test";
import { collectErrors } from "./helpers";

async function hostRoom(page: Page, name: string): Promise<string> {
  await page.goto("/?lang=en");
  await page.getByPlaceholder("e.g. Jason").fill(name);
  await page.getByRole("button", { name: "Create a room" }).click();
  const heading = page.getByRole("heading", { name: /^Room [A-Z]{5}$/ });
  await heading.waitFor();
  return ((await heading.textContent()) ?? "").slice(5);
}

test("a password keeps strangers out; chat works in the lobby and at the table", async ({ browser }) => {
  const errors: string[] = [];
  const host = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const guest = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  collectErrors(host, errors);
  collectErrors(guest, errors);
  // (the guest's failed joins below are 403s on purpose: not errors of the game)
  const code = await hostRoom(host, "Alice");

  // The host sets a password; it's shown to them, guests only learn there is one.
  await host.getByLabel("Room password").fill("plum blossom");
  await host.getByRole("button", { name: "Set", exact: true }).click();
  await expect(host.locator(".locked-note")).toBeVisible();
  await expect(host.getByRole("button", { name: "Remove", exact: true })).toBeVisible();

  // The invite link: the password field appears by itself for a locked room.
  await guest.goto(`/?room=${code}&lang=en`);
  await guest.getByPlaceholder("e.g. Jason").fill("Bob");
  const pw = guest.getByLabel("Room password");
  await expect(pw).toBeVisible();
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest.getByText("This room needs a password.")).toBeVisible();
  await pw.fill("plum");
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest.getByText("Wrong password.")).toBeVisible();
  await pw.fill("plum blossom");
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest.locator(".members li")).toHaveCount(2);
  await expect(guest.locator(".room-locked")).toHaveText("Needed to join");
  await expect(guest.getByLabel("Room password")).toHaveCount(0); // guests can't see or change it

  // Lobby chat, both ways.
  await guest.getByLabel("Chat message").fill("hello <b>all</b>");
  await guest.getByLabel("Chat message").press("Enter");
  await expect(host.locator(".chat-msg").last()).toHaveText("Bobhello <b>all</b>"); // plain text, never HTML
  await host.getByLabel("Chat message").fill("welcome!");
  await host.getByRole("button", { name: "Send" }).click();
  await expect(guest.locator(".chat-msg").last()).toContainText("welcome!");

  // At the table: the conversation carries over; T opens the chat; bubbles and an unread count.
  for (let i = 0; i < 2; i++) await host.getByRole("button", { name: "Add bot" }).click();
  await host.getByRole("button", { name: "Start game" }).click();
  // Both pick a hero (whenever their turn to pick comes), until each has one.
  await expect(async () => {
    for (const p of [host, guest]) {
      if (await p.locator(".hero-card").first().isVisible().catch(() => false)) await p.locator(".hero-card").first().click();
    }
    for (const p of [host, guest]) {
      await expect(p.locator(".dock-self")).not.toContainText("Choosing", { timeout: 300 });
      await expect(p.locator(".hero-card")).toHaveCount(0, { timeout: 300 });
    }
  }).toPass({ timeout: 60_000, intervals: [200] });
  await host.keyboard.press("t");
  await expect(host.locator(".side-chat .chat-input")).toBeFocused();
  await expect(host.locator(".side-chat .chat-msg")).toHaveCount(2); // the lobby chat is still there
  await host.keyboard.type("good luck");
  await host.keyboard.press("Enter");

  await expect(guest.locator('.seat-slot[data-seat="0"] .chat-bubble')).toHaveText("good luck");
  await expect(guest.locator(".log-toggle .unread, .chat-tab .unread").first()).toHaveText("1");
  await guest.getByRole("tab", { name: /Chat/ }).click();
  await expect(guest.locator(".side-chat .chat-msg").last()).toContainText("good luck");
  await expect(guest.locator(".unread")).toHaveCount(0); // read now
  await expect(guest.locator(".chat-bubble")).toHaveCount(0, { timeout: 10_000 }); // bubbles fade

  // Emotes: picked from the top bar, shown beside the sender's hero card for everyone.
  await host.getByRole("button", { name: "Emotes" }).click();
  await expect(host.getByRole("menuitem")).toHaveCount(10);
  await host.getByRole("menuitem", { name: "Nice!" }).click();
  await expect(host.getByRole("menu")).toHaveCount(0); // the picker closes
  const pop = guest.locator('.seat-slot[data-seat="0"] .emote-pop');
  await expect(pop).toContainText("Nice!");
  await expect(host.locator(".dock-self .emote-pop")).toContainText("Nice!");
  await expect(pop).toHaveCount(0, { timeout: 6000 }); // and goes again

  // The guest sits at the right edge of the host's table: their emote turns inward, uncut.
  await guest.getByRole("button", { name: "Emotes" }).click();
  await guest.getByRole("menuitem", { name: "Haha" }).click();
  const edgePop = host.locator('.seat-slot[data-seat="1"] .emote-pop');
  await expect(edgePop).toHaveAttribute("data-side", "left");
  const [popBox, arenaBox] = [await edgePop.boundingBox(), await host.locator(".arena").boundingBox()];
  expect(popBox!.x + popBox!.width).toBeLessThanOrEqual(arenaBox!.x + arenaBox!.width);
  await host.getByRole("button", { name: "Emotes" }).click();
  await host.keyboard.press("Escape");
  await expect(host.getByRole("menu")).toHaveCount(0); // Esc closes it too

  expect(errors.filter((e) => !/HTTP 403/.test(e))).toEqual([]);
});
