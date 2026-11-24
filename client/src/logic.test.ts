import { beforeEach, describe as group, expect, it } from "vitest";
import { setContent } from "./content";
import { _setLangForTests } from "./i18n";
import { describe, recentPlays } from "./describe";
import { handFan, opponentOrder, overlaps, plaqueHeightFor, sizeTier, tableLayout } from "./layout";
import { soundsFor } from "./components/Effects";
import { _reset, getState, onMessage } from "./net";
import {
  EMPTY,
  buildAnswer,
  cardClickable,
  chooseSkill,
  clickCard,
  clickSeat,
  complete,
  seatClickable,
} from "./selection";
import type { DiscardReq, PlayReq, RespondReq } from "./types";

beforeEach(() => _setLangForTests("en")); // these tests check the English wording

const play: PlayReq = {
  kind: "play",
  seat: 0,
  error: null,
  options: [
    { card_id: 10, target_count: 1, candidates: [1, 3], min_targets: null }, // strike
    { card_id: 11, target_count: 0, candidates: [], min_targets: null }, // peach
    { card_id: 12, target_count: 3, candidates: [1, 2, 3], min_targets: 1 }, // halberd strike
  ],
  conversions: [{ skill: "burning_fleet", as_name: "arrows", count: 2, cards: [10, 11, 13], target_count: 0, candidates: [], min_targets: null }],
  skills: [{ skill: "iron_edict", min_cards: 1, max_cards: 1, cards: [10, 11, 13], min_targets: 1, target_count: 1, candidates: [1, 2, 3] }],
};

group("selection: play phase", () => {
  it("only playable cards are clickable until a skill is chosen", () => {
    expect(cardClickable(play, EMPTY, 10)).toBe(true);
    expect(cardClickable(play, EMPTY, 13)).toBe(false);
    const s = chooseSkill(EMPTY, "iron_edict");
    expect(cardClickable(play, s, 13)).toBe(true);
  });

  it("card then target builds a play answer", () => {
    let s = clickCard(play, EMPTY, 10);
    expect(complete(play, s)).toBe(false);
    expect(seatClickable(play, s, 2)).toBe(false); // out of range
    s = clickSeat(play, s, 3);
    expect(complete(play, s)).toBe(true);
    expect(buildAnswer(play, s)).toEqual({ card_id: 10, targets: [3] });
    s = clickSeat(play, s, 1); // single target: replaces
    expect(s.targets).toEqual([1]);
  });

  it("untargeted cards are complete immediately; clicking again deselects", () => {
    const s = clickCard(play, EMPTY, 11);
    expect(complete(play, s)).toBe(true);
    expect(clickCard(play, s, 11)).toEqual(EMPTY);
  });

  it("multi-target ranges respect min and max", () => {
    let s = clickCard(play, EMPTY, 12);
    for (const t of [1, 2, 3]) s = clickSeat(play, s, t);
    expect(s.targets).toEqual([1, 2, 3]);
    expect(complete(play, s)).toBe(true);
  });

  it("conversions need exactly `count` cards", () => {
    let s = chooseSkill(EMPTY, "burning_fleet");
    s = clickCard(play, s, 10);
    expect(complete(play, s)).toBe(false);
    s = clickCard(play, s, 13);
    expect(complete(play, s)).toBe(true);
    expect(clickCard(play, s, 11).cards).toEqual([10, 13]); // can't exceed count
    expect(buildAnswer(play, s)).toEqual({ skill: "burning_fleet", cards: [10, 13], targets: [] });
  });

  it("active skills need cards and targets", () => {
    let s = chooseSkill(EMPTY, "iron_edict");
    s = clickSeat(play, clickCard(play, s, 13), 2);
    expect(buildAnswer(play, s)).toEqual({ skill: "iron_edict", cards: [13], targets: [2] });
    expect(chooseSkill(s, "iron_edict")).toEqual(EMPTY); // toggling the skill off
  });
});

group("selection: responses and discards", () => {
  const respond: RespondReq = {
    kind: "respond",
    seat: 0,
    error: null,
    card_name: "strike",
    reason: "barbarians",
    about: 2,
    options: [5],
    conversions: [{ skill: "serpent_spear", as_name: "strike", count: 2, cards: [5, 6, 7], target_count: 0, candidates: [], min_targets: null }],
    context: {},
  };

  it("respond with a real card or a conversion", () => {
    expect(cardClickable(respond, EMPTY, 6)).toBe(false);
    expect(buildAnswer(respond, clickCard(respond, EMPTY, 5))).toBe(5);
    let s = chooseSkill(EMPTY, "serpent_spear");
    s = clickCard(respond, clickCard(respond, s, 6), 7);
    expect(buildAnswer(respond, s)).toEqual({ skill: "serpent_spear", cards: [6, 7] });
  });

  it("discard exactly N", () => {
    const d: DiscardReq = { kind: "discard", seat: 0, error: null, count: 2, options: [1, 2, 3], reason: "discard_phase" };
    let s = clickCard(d, EMPTY, 1);
    expect(complete(d, s)).toBe(false);
    s = clickCard(d, clickCard(d, s, 2), 3);
    expect(s.cards).toEqual([1, 2]);
    expect(buildAnswer(d, s)).toEqual([1, 2]);
  });
});

group("layout", () => {
  it("next player sits on your right, previous on your left", () => {
    expect(opponentOrder(2, 5)).toEqual([3, 4, 0, 1]);
    const { seats } = tableLayout(4, 1200, 500)!;
    expect(seats[0].left).toBeGreaterThan(600);
    expect(seats[3].left + seats[3].width).toBeLessThan(600);
    expect(seats[1].top).toBeLessThan(seats[0].top); // outer seats curve down the sides
  });

  // Desktop table sizes: laptop to big monitor, log open or not.
  const SIZES: [number, number][] = [];
  for (const w of [700, 880, 1000, 1150, 1300, 1600, 1900]) for (const h of [322, 360, 420, 520, 700]) SIZES.push([w, h]);

  it("seats and the battlefield never overlap and stay on the table", () => {
    for (let count = 1; count <= 7; count++) {
      for (const [w, h] of SIZES) {
       for (const centerH of [126, 160]) {
        const layout = tableLayout(count, w, h, centerH);
        const where = `${count} opponents at ${w}x${h}, battlefield ${centerH}`;
        // Only very narrow tables with many players fall back to the stacked layout. (The
        // big battlefield is only used on tall windows: tables 460+ high.)
        if ((w >= 1000 || count <= 5) && (centerH === 126 || h >= 420)) expect(layout, where).not.toBeNull();
        if (!layout) continue;
        const { seats, center } = layout;
        const boxes = [...seats, center];
        for (const b of boxes) {
          expect(b.left, where).toBeGreaterThanOrEqual(0);
          expect(b.top, where).toBeGreaterThanOrEqual(0);
          expect(b.left + b.width, where).toBeLessThanOrEqual(w);
          expect(b.top + b.height, where).toBeLessThanOrEqual(h);
        }
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${where}: ${i} vs ${j}`).toBe(false);
       }
      }
    }
  });

  it("card sizes depend on the window only, and fit the table they leave", () => {
    expect(sizeTier(1440, 700).name).toBe("compact");
    expect(sizeTier(1440, 900).name).toBe("roomy");
    expect(sizeTier(1920, 1080).name).toBe("large");
    expect(sizeTier(390, 844).name).toBe("compact"); // phones
    // the bigger tiers still leave room for seats over the big battlefield (48px top bar)
    for (const [w, h] of [[1280, 820], [1440, 900], [1920, 1000], [1920, 1080]]) {
      const tier = sizeTier(w, h);
      expect(tableLayout(5, w - 300, h - 48 - tier.dockH, tier.centerH), `${w}x${h}`).not.toBeNull();
    }
  });

  it("depends only on the table size, never on what's on the plaques", () => {
    expect(tableLayout(5, 1200, 500)).toEqual(tableLayout(5, 1200, 500));
    expect(new Set(tableLayout(7, 1200, 500)!.seats.map((s) => s.height)).size).toBe(1);
    expect(tableLayout(7, 600, 500)).toBeNull();
    // a seat is a 5:7 hero card plus the fixed info rows
    for (const [n, w, h] of [[3, 1100, 540], [7, 1100, 540], [5, 1300, 322]]) {
      const l = tableLayout(n, w, h)!;
      for (const s of l.seats) expect(s.height).toBe(plaqueHeightFor(s.width));
    }
  });

  it("fanned hand keeps at least half of every card visible", () => {
    for (const n of [1, 4, 8, 15, 30]) {
      const { step, tilt } = handFan(n, 700);
      expect(step).toBeGreaterThanOrEqual(44);
      expect(step).toBeLessThanOrEqual(96);
      expect(Math.abs(tilt(0))).toBeLessThanOrEqual(8);
      expect(tilt(0) + tilt(n - 1)).toBe(0);
    }
    expect(handFan(4, 1000).step).toBe(96); // room to spare: no overlap
  });
});

group("sounds", () => {
  it("each kind of event has its sound; your turn and the result are yours alone", () => {
    const e = (type: string, more: Record<string, unknown> = {}) => ({ type, ...more });
    expect(
      soundsFor([e("use"), e("respond"), e("equip"), e("damage"), e("recover"), e("death"), e("draw"), e("turn_start", { seat: 2 })], 2),
    ).toEqual(["card", "card", "equip", "damage", "heal", "death", "turn"]);
    expect(soundsFor([e("turn_start", { seat: 1 })], 2)).toEqual([]); // someone else's turn: no bell
    expect(soundsFor([e("game_over", { winners: [0, 2] })], 2)).toEqual(["victory"]);
    expect(soundsFor([e("game_over", { winners: [0, 1] })], 2)).toEqual(["defeat"]);
  });
});

group("log text", () => {
  setContent({ cards: { strike: { title: "Strike", type: "basic", text: "" } }, heroes: [], skills: {} });
  const name = (s: number | null | undefined) => `P${s}`;
  const strike = { id: 1, name: "strike", suit: "spade" as const, rank: 7 };

  it("describes common events", () => {
    expect(describe({ type: "use", seat: 0, card: strike, targets: [2] }, name)?.text).toBe("P0 uses Strike ♠7 → P2");
    expect(describe({ type: "damage", source: 0, target: 2, amount: 1, nature: "fire", hp: 2 }, name)).toEqual({
      text: "P2 takes 1 fire damage from P0 (HP 2)",
      tone: "damage",
    });
    expect(describe({ type: "phase", seat: 0 }, name)).toBeNull();
  });

  it("recent plays stop at the turn boundary", () => {
    const log = [
      { type: "use", seat: 0, card: strike, targets: [1] },
      { type: "turn_start", seat: 1, turn: 2 },
      { type: "use", seat: 1, card: strike, targets: [0] },
      { type: "respond", seat: 0, card: { ...strike, name: "dodge" } },
    ];
    expect(recentPlays(log).map((p) => p.seat)).toEqual([1, 0]);
  });
});

group("net message handling", () => {
  it("accumulates log, resets on start=0, and tracks requests", () => {
    _reset();
    onMessage({ type: "log", start: 0, entries: [{ type: "a" }] });
    onMessage({ type: "log", start: 1, entries: [{ type: "b" }] });
    expect(getState().log.map((e) => e.type)).toEqual(["a", "b"]);
    onMessage({ type: "log", start: 0, entries: [{ type: "c" }] });
    expect(getState().log.map((e) => e.type)).toEqual(["c"]);
    onMessage({ type: "request", id: 7, request: { kind: "confirm" }, timeout: 10 });
    expect(getState().request?.id).toBe(7);
    onMessage({ type: "timeout", id: 6 });
    expect(getState().request?.id).toBe(7);
  });
});
