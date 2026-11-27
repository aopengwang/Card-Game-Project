import { play } from "../sound";
import type { Card } from "../types";
import { fxSpeed } from "./stage";
import s from "./Launch.module.css";

/*
 * SpaceX (Yilong Ma's Launch): a stainless-steel rocket rises out of his hero card, its
 * engines light, smoke billows over the seat and the seat shakes; it hangs for a moment,
 * then climbs away off the top of the screen on a long flame, leaving an exhaust trail.
 * As it lifts off, the equipment it gave up for the launch is jettisoned: each card blasts
 * out of its side face up, hangs long enough to read, then tumbles away and falls.
 *
 * Drawn on the effects layer (an inline SVG rocket, CSS animation); the table never moves.
 */

/** Timings at speed 1 (ms); `ignite`, `liftoff` and `eject` are fractions of `total`. */
export const LAUNCH = { total: 3000, ignite: 0.11, liftoff: 0.34, eject: 0.36 } as const;

/** Draws a card face into `el` (the table's own Card); returns how to clean it up. */
export type RenderCard = (el: HTMLElement, card: Card) => () => void;

const PUFFS = 9;
let seq = 0; // unique SVG gradient ids

function div(parent: HTMLElement, cls: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/** The rocket: a steel body with an ogive nose, dark heat tiles down one side, two pairs of
 * flaps and three engine bells. */
function rocketSvg(): string {
  const id = `steel${++seq}`;
  return `<svg viewBox="0 0 40 140" width="100%" height="100%" aria-hidden="true">
  <defs>
    <linearGradient id="${id}" x1="0" x2="1">
      <stop offset="0" stop-color="#6f7882"/><stop offset="0.38" stop-color="#eef1f3"/>
      <stop offset="0.62" stop-color="#b9c0c7"/><stop offset="1" stop-color="#5f6770"/>
    </linearGradient>
  </defs>
  <path d="M9 32 L1 44 L1 50 L9 48 Z M31 32 L39 44 L39 50 L31 48 Z" fill="#30353b"/>
  <path d="M9 102 L0 120 L0 128 L9 127 Z M31 102 L40 120 L40 128 L31 127 Z" fill="#30353b"/>
  <path d="M9 44 Q9 8 20 2 Q31 8 31 44 L31 128 L9 128 Z" fill="url(#${id})"/>
  <path d="M9 44 Q9 8 20 2 L14 20 Q12 34 13 44 L13 128 L9 128 Z" fill="#23272c" opacity="0.88"/>
  <g stroke="rgba(0,0,0,0.18)" stroke-width="0.6">
    <line x1="9" y1="56" x2="31" y2="56"/><line x1="9" y1="72" x2="31" y2="72"/>
    <line x1="9" y1="88" x2="31" y2="88"/><line x1="9" y1="104" x2="31" y2="104"/>
  </g>
  <path d="M12 128 L14 136 L18 136 L18 128 Z M18.5 128 L18.5 137 L21.5 137 L21.5 128 Z M22 128 L22 136 L26 136 L28 128 Z" fill="#3a3f46"/>
</svg>`;
}

/**
 * @param jettisoned the equipment discarded for the launch (shown flying off it)
 * @param renderCard draws those cards' faces
 */
export function launch(layer: HTMLElement, seat: number, jettisoned: Card[] = [], renderCard?: RenderCard): Promise<void> {
  const k = 1 / fxSpeed();
  const seatEl = document.querySelector(`[data-seat="${seat}"]`);
  const face = seatEl?.querySelector(".hero-face") ?? seatEl;
  const base = layer.getBoundingClientRect();
  const r = face?.getBoundingClientRect();
  if (!r || !r.width) {
    play("launch");
    return Promise.resolve();
  }
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1; // the interface size
  const x = (r.left + r.width / 2 - base.left) / zoom;
  const y = (r.top + r.height / 2 - base.top) / zoom;
  const w = Math.min(160, Math.max(90, r.width / zoom));
  const total = LAUNCH.total * k;

  const root = div(layer, `${s.launch} launch-fx`);
  Object.assign(root.style, { left: `${x}px`, top: `${y}px` });
  root.style.setProperty("--life", `${total}ms`);
  root.style.setProperty("--w", `${w}px`);
  root.style.setProperty("--rise", `${y + w * 2.4}px`); // clear off the top of the table

  div(root, s.trail);
  const smoke = div(root, s.smoke);
  for (let i = 0; i < PUFFS; i++) {
    const p = div(smoke, s.puff);
    const side = i % 2 ? 1 : -1;
    p.style.setProperty("--dx", `${side * (0.25 + (i % 4) * 0.22) * w}px`);
    p.style.setProperty("--dy", `${(0.05 + (i % 3) * 0.08) * w}px`);
    p.style.setProperty("--d", `${(i * 0.025).toFixed(3)}`); // fraction of --life
  }
  div(root, s.glow);
  // The jettisoned equipment: alternately left and right, each one further out than the last
  // on its side; a seat near the edge of the screen sends them all out the open side.
  const cleanups: (() => void)[] = [];
  if (renderCard) {
    const width = layer.offsetWidth;
    // How high they hang (× the card width, up is negative): above the seat, or level with
    // it when the seat is near the top of the screen.
    // (a card's top edge stays clear of the top bar: half a card ≈ 50px, the bar ≈ 50px)
    const bar = document.querySelector(".topbar")?.getBoundingClientRect();
    const top = bar ? Math.max(0, (bar.bottom - base.top) / zoom) : 50; // (in layer pixels)
    // (cards leave from the rocket's middle, 0.42 card-widths above the seat's centre)
    root.style.setProperty("--lift", String(Math.min(0.5, Math.max(-0.6, (top + 60 - y) / w + 0.42))));
    const reach = (n: number) => w * (0.9 + n * 0.62) + 45; // (to the card's far edge)
    const out = { [-1]: 0, [1]: 0 } as Record<-1 | 1, number>;
    const fits = (side: -1 | 1) => (side < 0 ? x - reach(out[-1]) > 0 : x + reach(out[1]) < width);
    jettisoned.slice(0, 4).forEach((card, i) => {
      const want: -1 | 1 = i % 2 ? 1 : -1;
      const side: -1 | 1 = fits(want) || !fits(-want as -1 | 1) ? want : (-want as -1 | 1);
      const n = out[side]++;
      const eject = div(root, `${s.eject} launch-eject`);
      eject.dataset.card = card.name;
      eject.style.setProperty("--side", String(side));
      eject.style.setProperty("--n", String(n));
      eject.style.setProperty("--spin", `${side * (10 + i * 4)}deg`);
      div(eject, s.ejectPuff);
      cleanups.push(renderCard(div(eject, s.ejectCard), card));
    });
  }
  const rocket = div(root, `${s.rocket} launch-rocket`);
  div(rocket, s.flame);
  const body = div(rocket, s.body);
  body.innerHTML = rocketSvg();

  return new Promise((done) => {
    if (jettisoned.length) window.setTimeout(() => play("eject"), total * LAUNCH.eject);
    window.setTimeout(() => {
      play("launch");
      seatEl?.querySelector(".seat")?.animate(
        [
          { transform: "none" },
          { transform: "translate(-2px, 1px)" },
          { transform: "translate(2px, -1px)" },
          { transform: "translate(-2px, 0)" },
          { transform: "translate(1px, 1px)" },
          { transform: "none" },
        ],
        { duration: total * (LAUNCH.liftoff - LAUNCH.ignite) + 200 * k, easing: "linear" },
      );
    }, total * LAUNCH.ignite);
    window.setTimeout(() => {
      cleanups.forEach((c) => c());
      root.remove();
      done();
    }, total);
  });
}
