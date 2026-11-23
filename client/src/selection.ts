// Pure selection logic for answering requests: what's clickable, what's selected,
// when an answer is complete, and the JSON answer to send. No React here (unit-tested).
import { t } from "./i18n";
import type { GameRequest, PlayReq, RespondReq } from "./types";

export type Mode = { type: "card"; cardId: number } | { type: "skill"; skill: string } | null;

export interface Selection {
  mode: Mode;
  cards: number[];
  targets: number[];
}

export const EMPTY: Selection = { mode: null, cards: [], targets: [] };

/** What the current mode needs: a pool of cards to pick from and a pool of targets. */
export interface Spec {
  cardPool: number[];
  minCards: number;
  maxCards: number;
  candidates: number[];
  minTargets: number;
  maxTargets: number;
}

function playSpec(r: PlayReq, sel: Selection): Spec | null {
  const m = sel.mode;
  if (!m) return null;
  if (m.type === "card") {
    const o = r.options.find((x) => x.card_id === m.cardId);
    if (!o) return null;
    return {
      cardPool: [],
      minCards: 0,
      maxCards: 0,
      candidates: o.candidates,
      minTargets: o.min_targets ?? o.target_count,
      maxTargets: o.target_count,
    };
  }
  const c = r.conversions.find((x) => x.skill === m.skill);
  if (c) {
    return {
      cardPool: c.cards,
      minCards: c.count,
      maxCards: c.count,
      candidates: c.candidates,
      minTargets: c.min_targets ?? c.target_count,
      maxTargets: c.target_count,
    };
  }
  const s = r.skills.find((x) => x.skill === m.skill);
  if (s) {
    return {
      cardPool: s.cards,
      minCards: s.min_cards,
      maxCards: s.max_cards,
      candidates: s.candidates,
      minTargets: s.min_targets,
      maxTargets: s.target_count,
    };
  }
  return null;
}

function respondSpec(r: RespondReq, sel: Selection): Spec {
  const m = sel.mode;
  if (m?.type === "skill") {
    const c = r.conversions.find((x) => x.skill === m.skill);
    if (c) return { cardPool: c.cards, minCards: c.count, maxCards: c.count, candidates: [], minTargets: 0, maxTargets: 0 };
  }
  return { cardPool: r.options, minCards: 1, maxCards: 1, candidates: [], minTargets: 0, maxTargets: 0 };
}

export function spec(r: GameRequest, sel: Selection): Spec | null {
  switch (r.kind) {
    case "play":
      return playSpec(r, sel);
    case "respond":
      return respondSpec(r, sel);
    case "discard":
      return { cardPool: r.options, minCards: r.count, maxCards: r.count, candidates: [], minTargets: 0, maxTargets: 0 };
    case "choose_player":
      return { cardPool: [], minCards: 0, maxCards: 0, candidates: r.options, minTargets: 1, maxTargets: 1 };
    default:
      return null;
  }
}

/** Can this hand card be clicked right now? */
export function cardClickable(r: GameRequest | null, sel: Selection, cardId: number): boolean {
  if (!r) return false;
  if (r.kind === "play" && sel.mode?.type !== "skill") return r.options.some((o) => o.card_id === cardId);
  const s = spec(r, sel);
  return !!s && s.cardPool.includes(cardId);
}

export function seatClickable(r: GameRequest | null, sel: Selection, seat: number): boolean {
  if (!r) return false;
  const s = spec(r, sel);
  return !!s && s.maxTargets > 0 && s.candidates.includes(seat);
}

const toggle = (xs: number[], x: number) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

export function clickCard(r: GameRequest, sel: Selection, cardId: number): Selection {
  if (!cardClickable(r, sel, cardId)) return sel;
  if (r.kind === "play" && sel.mode?.type !== "skill") {
    // Picking a different card switches to it; clicking the selected card again deselects.
    if (sel.mode?.type === "card" && sel.mode.cardId === cardId) return EMPTY;
    return { mode: { type: "card", cardId }, cards: [], targets: [] };
  }
  const s = spec(r, sel)!;
  if (s.maxCards === 1 && !sel.cards.includes(cardId)) return { ...sel, cards: [cardId] };
  const cards = toggle(sel.cards, cardId);
  return cards.length > s.maxCards ? sel : { ...sel, cards };
}

export function clickSeat(r: GameRequest, sel: Selection, seat: number): Selection {
  if (!seatClickable(r, sel, seat)) return sel;
  const s = spec(r, sel)!;
  if (s.maxTargets === 1 && !sel.targets.includes(seat)) return { ...sel, targets: [seat] };
  const targets = toggle(sel.targets, seat);
  return targets.length > s.maxTargets ? sel : { ...sel, targets };
}

export function chooseSkill(sel: Selection, skill: string): Selection {
  if (sel.mode?.type === "skill" && sel.mode.skill === skill) return EMPTY;
  return { mode: { type: "skill", skill }, cards: [], targets: [] };
}

export function complete(r: GameRequest, sel: Selection): boolean {
  const s = spec(r, sel);
  if (!s) return false;
  return (
    sel.cards.length >= s.minCards &&
    sel.cards.length <= s.maxCards &&
    sel.targets.length >= s.minTargets &&
    sel.targets.length <= s.maxTargets
  );
}

/** The JSON answer for a complete selection (see server/net/protocol.py). */
export function buildAnswer(r: GameRequest, sel: Selection): unknown {
  switch (r.kind) {
    case "play":
      if (sel.mode?.type === "card") return { card_id: sel.mode.cardId, targets: sel.targets };
      if (sel.mode?.type === "skill") return { skill: sel.mode.skill, cards: sel.cards, targets: sel.targets };
      return null;
    case "respond":
      if (sel.mode?.type === "skill") return { skill: sel.mode.skill, cards: sel.cards };
      return sel.cards[0] ?? null;
    case "discard":
      return sel.cards;
    case "choose_player":
      return sel.targets[0];
    default:
      return null;
  }
}

/** Short instruction line for the action bar. */
export function hint(r: GameRequest, sel: Selection): string {
  const s = spec(r, sel);
  if (r.kind === "play" && !sel.mode) return t("act.hintPlay");
  if (!s) return "";
  const parts: string[] = [];
  if (s.maxCards > 0) {
    const need = s.minCards === s.maxCards ? `${s.minCards}` : `${s.minCards}-${s.maxCards}`;
    parts.push(t("act.cards", { have: sel.cards.length, need }));
  }
  if (s.maxTargets > 0) {
    const need = s.minTargets === s.maxTargets ? `${s.maxTargets}` : `${s.minTargets}-${s.maxTargets}`;
    parts.push(t("act.targets", { have: sel.targets.length, need }));
  }
  return parts.join(" · ");
}
