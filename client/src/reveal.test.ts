import { beforeEach, describe, expect, it } from "vitest";
import { launchedAt, revealOf } from "./components/Effects";
import { _setLangForTests } from "./i18n";
import type { Card } from "./types";

const card = (id: number, suit: Card["suit"], name = "strike"): Card => ({ id, name, suit, rank: 7 });
const names = (seat: number) => ["You", "Bob", "Cy", "Di"][seat];

describe("cards shown to the table", () => {
  beforeEach(() => _setLangForTests("en"));

  it("Fire Attack: the shown card, and a word for the attacker who has no card of its suit", () => {
    const e = { type: "show", seat: 1, card: card(5, "heart"), reason: "fire_attack", source: 0 };
    const stuck = revealOf(e, 0, [card(1, "spade"), card(2, "club")], names)!;
    expect(stuck.title).toBe("Bob shows a card (Fire Attack)");
    expect(stuck.cards.map((c) => c.id)).toEqual([5]);
    expect(stuck.note).toBe("You have no ♥ Hearts card: your Fire Attack does nothing.");
    expect(revealOf(e, 0, [card(1, "heart")], names)!.note).toBeNull(); // you can go on
    expect(revealOf(e, 2, [], names)!.note).toBeNull(); // not your Fire Attack: just the card
  });

  it("What's up Beijing!: the whole hand, or a note that it's empty", () => {
    const e = { type: "show_hand", seat: 0, cards: [card(1, "spade"), card(2, "heart")], reason: "whats_up_beijing" };
    const r = revealOf(e, 2, [], names)!;
    expect(r.title).toMatch(/^You shows their hand \(.+\)$/);
    expect(r.cards).toHaveLength(2);
    expect(revealOf({ ...e, cards: [] }, 2, [], names)!.note).toBe("No hand cards");
  });

  it("knows when Yilong Ma is launched (his Strikes fire missiles then)", () => {
    const strike = { type: "use", seat: 1, card: card(9, "spade"), targets: [2] };
    const log = [
      { type: "turn_start", seat: 1 },
      strike, // 1: before the launch
      { type: "token", seat: 1, token: "launch", count: 1, delta: 1 },
      { type: "token", seat: 3, token: "launch", count: 0, delta: -1 }, // (someone else's: no matter)
      strike, // 4: launched
      { type: "token", seat: 1, token: "launch", count: 0, delta: -1 },
      strike, // 6: the extra phase is over
      { type: "turn_start", seat: 2 },
      { ...strike, seat: 2 }, // 8: someone else's turn
    ];
    expect([1, 4, 6, 8].map((i) => launchedAt(log, i, log[i].seat))).toEqual([false, true, false, false]);
  });

  it("other entries show nothing", () => {
    expect(revealOf({ type: "use", seat: 0, card: card(1, "spade") }, 0, [])).toBeNull();
  });
});
