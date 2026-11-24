import { beforeEach, describe as group, expect, it } from "vitest";
import { setContent } from "./content";
import { _setLangForTests } from "./i18n";
import { describe, recentPlays } from "./describe";
import { opponentOrder, seatPositions } from "./layout";
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
    const pos = seatPositions(4);
    expect(pos[0].x).toBeGreaterThan(50);
    expect(pos[3].x).toBeLessThan(50);
    // y is a 0-100 position within the seat band: middle seats higher than the end ones
    for (const p of pos) expect(p.y).toBeGreaterThanOrEqual(0);
    for (const p of pos) expect(p.y).toBeLessThanOrEqual(100);
    expect(pos[1].y).toBeLessThan(pos[0].y);
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
