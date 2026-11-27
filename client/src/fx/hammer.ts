import { play } from "../sound";
import { fxSpeed } from "./stage";
import s from "./Hammer.module.css";

/*
 * Marks uses a skill (Communism, Sharing): a golden hammer and sickle flashes once over his hero
 * card, struck in with a red glow and a shock ring, then fades.
 * The glow is drawn with `mix-blend-mode: screen` so the card stays visible through it.
 */

/** Length at speed 1 (ms). */
export const HAMMER_MS = 1100;

function div(parent: HTMLElement, cls: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  parent.appendChild(e);
  return e;
}

const EMBLEM = `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
  <defs>
    <linearGradient id="hsGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff3b0"/><stop offset="0.45" stop-color="#ffd34d"/><stop offset="1" stop-color="#d99a16"/>
    </linearGradient>
  </defs>
  <g stroke="#7a1010" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" fill="url(#hsGold)">
    <path d="M32 68 A28 28 0 1 1 78 58" fill="none" stroke="#7a1010" stroke-width="13"/>
    <path d="M32 68 A28 28 0 1 1 78 58" fill="none" stroke="url(#hsGold)" stroke-width="8"/>
    <path d="M33 67 L19 83" fill="none" stroke="#7a1010" stroke-width="12"/>
    <path d="M33 67 L19 83" fill="none" stroke="url(#hsGold)" stroke-width="7"/>
    <path d="M38 42 L77 81" fill="none" stroke="#7a1010" stroke-width="11"/>
    <path d="M38 42 L77 81" fill="none" stroke="url(#hsGold)" stroke-width="6"/>
    <polygon points="50,36 42,28 24,46 32,54"/>
  </g>
</svg>`;

export function hammer(layer: HTMLElement, seat: number): Promise<void> {
  const k = 1 / fxSpeed();
  const seatEl = document.querySelector(`[data-seat="${seat}"]`);
  const face = seatEl?.querySelector(".hero-face") ?? seatEl;
  const base = layer.getBoundingClientRect();
  const r = face?.getBoundingClientRect();
  play("anvil");
  if (!r || !r.width) return Promise.resolve();
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1; // the interface size
  const total = HAMMER_MS * k;

  const root = div(layer, `${s.hammer} hammer-fx`);
  Object.assign(root.style, { left: `${(r.left + r.width / 2 - base.left) / zoom}px`, top: `${(r.top + r.height / 2 - base.top) / zoom}px` });
  root.style.setProperty("--life", `${total}ms`);
  root.style.setProperty("--size", `${(Math.min(r.width, r.height) / zoom) * 0.9}px`);

  const glow = div(root, s.glow);
  div(glow, s.ring);
  div(root, `${s.emblem} hammer-emblem`).innerHTML = EMBLEM;

  return new Promise((done) => {
    window.setTimeout(() => {
      root.remove();
      done();
    }, total);
  });
}
