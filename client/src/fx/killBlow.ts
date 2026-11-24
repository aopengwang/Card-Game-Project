import { play } from "../sound";
import { fxSpeed } from "./stage";
import s from "./KillBlow.module.css";

/*
 * A killing blow: the killer's hero card lifts off its seat, flies over the victim, winds
 * up and slams down onto the victim's card. On impact the seat shakes, a shockwave and an
 * ink burst go out, the gong sounds, and the victim greys out under the "Fallen" stamp.
 * With no killer (Lightning, say) only the impact plays.
 *
 * Drawn on the effects layer with copies of real DOM (the killer's card, your art and
 * all), so nothing on the table itself moves except the victim's shake.
 */

/** Timings at speed 1 (ms). Impact is when the card meets the victim's card. */
export const KILL = { withKiller: 1500, impact: 0.74, alone: 700, aloneImpact: 0.5, linger: 500 } as const;

type Rect = { x: number; y: number; w: number; h: number }; // centre and size, in layer pixels

function rectIn(layer: HTMLElement, el: Element | null): Rect | null {
  if (!el) return null;
  const base = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  // rects are in screen pixels; the layer's own pixels are zoomed by the interface size
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1;
  return { x: (r.left + r.width / 2 - base.left) / zoom, y: (r.top + r.height / 2 - base.top) / zoom, w: r.width / zoom, h: r.height / zoom };
}

const slot = (seat: number) => document.querySelector(`[data-seat="${seat}"]`);
const faceOf = (seat: number) => slot(seat)?.querySelector(".hero-face") ?? null;

/**
 * Keep a seat looking alive (no grey, no stamp) until its blow lands. Call before the
 * browser paints the death; returns the release.
 */
export function holdDeath(seat: number): () => void {
  const el = slot(seat);
  el?.setAttribute("data-fx-hold", "");
  return () => el?.removeAttribute("data-fx-hold");
}

function piece(layer: HTMLElement, cls: string, at: Rect, w: number, h: number, ms: number): HTMLElement {
  const el = document.createElement("div");
  el.className = cls;
  Object.assign(el.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${w}px`, height: `${h}px`, animationDuration: `${ms}ms` });
  layer.appendChild(el);
  return el;
}

export function killBlow(layer: HTMLElement, killer: number | null, victim: number, release: () => void): Promise<void> {
  const k = 1 / fxSpeed();
  const to = rectIn(layer, faceOf(victim));
  const killerFace = killer != null && killer !== victim ? faceOf(killer) : null;
  const from = rectIn(layer, killerFace);
  if (!to) {
    release();
    return Promise.resolve();
  }
  const total = (from ? KILL.withKiller : KILL.alone) * k;
  const impactAt = total * (from ? KILL.impact : KILL.aloneImpact);
  const made: HTMLElement[] = [];
  const whole = { x: layer.offsetWidth / 2, y: layer.offsetHeight / 2, w: 0, h: 0 };

  // the table darkens around the blow
  made.push(piece(layer, s.dim, whole, layer.offsetWidth, layer.offsetHeight, total + KILL.linger * k));

  if (from && killerFace) {
    const card = piece(layer, `${s.card} kill-card`, to, from.w, from.h, total);
    card.style.setProperty("--dx", `${from.x - to.x}px`);
    card.style.setProperty("--dy", `${from.y - to.y}px`);
    card.style.setProperty("--fit", String(to.w / from.w)); // lands exactly on the victim's card
    card.style.setProperty("--above", `${-(to.h * 0.75 + 40)}px`);
    card.appendChild(killerFace.cloneNode(true));
    made.push(card);
    // the card has left its seat: only a faint trace stays behind until it returns
    killerFace.animate([{ opacity: 1 }, { opacity: 0.3, offset: 0.12 }, { opacity: 0.3, offset: 0.86 }, { opacity: 1 }], {
      duration: total,
    });
  }

  return new Promise((done) => {
    window.setTimeout(() => {
      release(); // grey and the "Fallen" stamp land with the blow
      play("slam");
      play("death", 0.12);
      made.push(piece(layer, s.flash, to, to.w, to.h, 420 * k));
      made.push(piece(layer, s.ring, to, to.w * 1.1, to.w * 1.1, 700 * k));
      const burst = piece(layer, s.burst, to, 0, 0, 0);
      for (let i = 0; i < 12; i++) {
        const spoke = document.createElement("i");
        spoke.style.setProperty("--a", `${i * 30 + (i % 2) * 11}deg`);
        spoke.style.setProperty("--r", `${to.w * (0.75 + (i % 3) * 0.18)}px`);
        spoke.style.animationDuration = `${560 * k}ms`;
        burst.appendChild(spoke);
      }
      made.push(burst);
      // Web Animations, not a class: React re-renders would strip a class mid-shake.
      slot(victim)
        ?.querySelector(".seat")
        ?.animate(
          [
            { transform: "none" },
            { transform: "translate(-7px, 4px) rotate(-1.5deg)" },
            { transform: "translate(6px, -3px) rotate(1.2deg)" },
            { transform: "translate(-4px, 2px)" },
            { transform: "translate(2px, -1px)" },
            { transform: "none" },
          ],
          { duration: 460 * k, easing: "ease-out" },
        );
    }, impactAt);
    window.setTimeout(() => {
      made.forEach((el) => el.remove());
      done();
    }, total + KILL.linger * k);
  });
}
