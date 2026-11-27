import { play } from "../sound";
import { fxSpeed } from "./stage";
import s from "./Judgment.module.css";

/*
 * A judgment: the judgment card rises over the judged player's hero card face down, flips
 * face up, and a seal stamps onto it: "Hit" or "Miss", with what was judged underneath.
 * Always the same colours, whatever was judged: a hit is green (with a chime), a miss is
 * red (with a thud, and the seat shakes).
 *
 * Drawn on the effects layer with a copy of the judgment card from the battlefield, so the
 * table itself never moves.
 */

/** Timings at speed 1 (ms); `stamp` is when the seal lands (fraction of `total`). */
export const JUDGE = { total: 1500, stamp: 0.46 } as const;

type Rect = { x: number; y: number; w: number; h: number };

function rectIn(layer: HTMLElement, el: Element | null): Rect | null {
  if (!el) return null;
  const base = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1; // the interface size
  return { x: (r.left + r.width / 2 - base.left) / zoom, y: (r.top + r.height / 2 - base.top) / zoom, w: r.width / zoom, h: r.height / zoom };
}

function div(parent: HTMLElement, cls: string, text?: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export interface JudgmentShow {
  seat: number;
  hit: boolean;
  /** "Hit" / "Miss" in the current language. */
  word: string;
  /** What was judged ("Indulgence", "Eight Trigrams"...). */
  reason: string;
  zh: boolean;
  /** A copy of the judgment card as drawn on the battlefield, if it was there... */
  cardEl: Element | null;
  /** ...and its size then (layer pixels): a detached copy can't be measured. */
  cardSize?: { w: number; h: number } | null;
}

export function judgment(layer: HTMLElement, j: JudgmentShow): Promise<void> {
  const k = 1 / fxSpeed();
  const seatEl = document.querySelector(`[data-seat="${j.seat}"]`);
  const at = rectIn(layer, seatEl?.querySelector(".hero-face") ?? seatEl ?? null);
  if (!at) return Promise.resolve();
  const total = JUDGE.total * k;
  const root = div(layer, `${s.judgment} ${j.hit ? s.hit : s.miss} judgment-fx`);
  root.dataset.result = j.hit ? "hit" : "miss";
  Object.assign(root.style, { left: `${at.x}px`, top: `${at.y}px` });
  root.style.setProperty("--life", `${total}ms`);

  // The card: about two thirds of the hero card's width, never bigger than a hand card.
  const cardW = Math.min(110, Math.max(64, at.w * 0.68));
  root.style.setProperty("--w", `${cardW}px`);
  const card = div(root, s.card);
  const back = div(card, s.back);
  div(back, s.backMark, "判");
  const front = div(card, s.front);
  if (j.cardEl && j.cardSize) {
    const copy = j.cardEl.cloneNode(true) as HTMLElement;
    const fit = cardW / j.cardSize.w;
    Object.assign(copy.style, { transform: `scale(${fit})`, transformOrigin: "top left", margin: "0" });
    front.appendChild(copy);
    card.style.height = `${j.cardSize.h * fit}px`;
  } else {
    // no card to copy (it scrolled off the battlefield): a plain face with the outcome
    front.classList.add(s.blank);
  }

  const seal = div(root, `${s.seal} judgment-seal`);
  const word = div(seal, s.word, j.word);
  if (j.zh) word.lang = "zh-CN";
  div(seal, s.reason, j.reason);
  div(root, s.ring);

  return new Promise((done) => {
    window.setTimeout(() => {
      play(j.hit ? "judgeHit" : "judgeMiss");
      if (!j.hit) {
        seatEl?.querySelector(".seat")?.animate(
          [
            { transform: "none" },
            { transform: "translate(-4px, 2px)" },
            { transform: "translate(3px, -2px)" },
            { transform: "translate(-2px, 1px)" },
            { transform: "none" },
          ],
          { duration: 320 * k, easing: "ease-out" },
        );
      }
    }, total * JUDGE.stamp);
    window.setTimeout(() => {
      root.remove();
      done();
    }, total);
  });
}
