import { play } from "../sound";
import { fxSpeed } from "./stage";
import s from "./BabyOil.module.css";

/*
 * Baby Oil (Diddy): a bottle of oil is thrown from Diddy's hero card at the target's, spinning
 * end over end along an arc, and bursts on it: a glossy golden splat, droplets flying out,
 * and oil running down the card in drips. The target's Slippery chip (held back until now)
 * appears as it lands, and the oil fades.
 *
 * Drawn on the effects layer: the bottle flies with the Web Animations API (a true arc between
 * two seats only known at runtime), the splash is CSS. The table never moves.
 */

/** Timings at speed 1 (ms); `impact` is when the bottle lands (fraction of `total`). */
export const OIL = { total: 2000, impact: 0.42 } as const;

const DROPS = 10;
const DRIPS = 4;

function div(parent: HTMLElement, cls: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/** Keep the seat's Slippery chip out of sight until the oil lands. Returns the release. */
export function holdSlippery(seat: number): () => void {
  const el = document.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
  if (!el) return () => {};
  el.dataset.fxSlippery = "";
  let done = false;
  return () => {
    if (done) return;
    done = true;
    delete el.dataset.fxSlippery;
  };
}

/** A plain bottle of baby oil: amber, a white flip cap, a label with a drop on it. */
const BOTTLE = `<svg viewBox="0 0 30 60" width="100%" height="100%" aria-hidden="true">
  <defs>
    <linearGradient id="oilGlass" x1="0" x2="1">
      <stop offset="0" stop-color="#d88a2a" stop-opacity="0.9"/><stop offset="0.35" stop-color="#ffd98f" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#c47518" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect x="10" y="0" width="10" height="8" rx="2" fill="#f1ece4" stroke="#c9c0b2" stroke-width="0.6"/>
  <rect x="9" y="7" width="12" height="3" rx="1" fill="#ddd5c8"/>
  <path d="M11 10 L19 10 L22 16 L8 16 Z" fill="url(#oilGlass)"/>
  <rect x="4" y="15" width="22" height="43" rx="7" fill="url(#oilGlass)"/>
  <rect x="5" y="30" width="20" height="27" rx="6" fill="#b8640f" opacity="0.35"/>
  <rect x="7" y="27" width="16" height="17" rx="2" fill="#fff7e8"/>
  <path d="M15 30 C17.5 33.5 19 35.5 19 37.5 A4 4 0 0 1 11 37.5 C11 35.5 12.5 33.5 15 30 Z" fill="#e7a33c"/>
  <rect x="6.5" y="18" width="2.4" height="34" rx="1.2" fill="#fff" opacity="0.55"/>
</svg>`;

/** A splat: an irregular blob (seeded, so it's the same shape every time), glossy and golden. */
function splatSvg(): string {
  const pts: [number, number][] = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 30 + 12 * Math.sin(i * 2.7) + 6 * Math.cos(i * 5.3); // lumpy, not random
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // a smooth closed path through the midpoints, the points themselves as control points
  const mid = (p: [number, number], q: [number, number]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let d = `M${mid(pts[n - 1], pts[0]).join(" ")}`;
  for (let i = 0; i < n; i++) d += ` Q${pts[i].join(" ")} ${mid(pts[i], pts[(i + 1) % n]).join(" ")}`;
  return `<svg viewBox="-50 -50 100 100" width="100%" height="100%" aria-hidden="true">
  <defs>
    <radialGradient id="oilSplat" cx="0.42" cy="0.38" r="0.7">
      <stop offset="0" stop-color="#fff2c4" stop-opacity="0.95"/><stop offset="0.35" stop-color="#f6c766" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#c98222" stop-opacity="0.7"/>
    </radialGradient>
  </defs>
  <path d="${d}" fill="url(#oilSplat)"/>
  <ellipse cx="-10" cy="-12" rx="11" ry="6" fill="#fff" opacity="0.6" transform="rotate(-25 -10 -12)"/>
  <ellipse cx="9" cy="10" rx="4" ry="2.4" fill="#fff" opacity="0.4"/>
</svg>`;
}

export interface OilShow {
  /** Who threw it (null: no thrower found, just the splash). */
  from: number | null;
  seat: number;
  /** Shows the seat's Slippery chip (from holdSlippery). */
  release: () => void;
}

export function babyOil(layer: HTMLElement, o: OilShow): Promise<void> {
  const k = 1 / fxSpeed();
  const base = layer.getBoundingClientRect();
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1; // the interface size
  const faceOf = (seat: number) => {
    const seatEl = document.querySelector(`[data-seat="${seat}"]`);
    const r = (seatEl?.querySelector(".hero-face") ?? seatEl)?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return { x: (r.left + r.width / 2 - base.left) / zoom, y: (r.top + r.height / 2 - base.top) / zoom, w: r.width / zoom, h: r.height / zoom };
  };
  const at = faceOf(o.seat);
  if (!at) {
    o.release();
    play("splat");
    return Promise.resolve();
  }
  const from = o.from != null && o.from !== o.seat ? faceOf(o.from) : null;
  const total = OIL.total * k;
  const impact = total * OIL.impact;

  const root = div(layer, `${s.oil} oil-fx`);
  Object.assign(root.style, { left: `${at.x}px`, top: `${at.y}px` });
  root.style.setProperty("--life", `${total}ms`);
  root.style.setProperty("--w", `${at.w}px`);
  root.style.setProperty("--h", `${at.h}px`);

  // The splash, waiting for the bottle: the splat, droplets thrown out, drips running down.
  const splash = div(root, `${s.splash} oil-splash`);
  const splat = div(splash, s.splat);
  splat.innerHTML = splatSvg();
  for (let i = 0; i < DROPS; i++) {
    const a = (i / DROPS) * Math.PI * 2 + 0.4;
    const d = at.w * (0.38 + (i % 3) * 0.1);
    const drop = div(splash, s.drop);
    drop.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    drop.style.setProperty("--dy", `${Math.sin(a) * d * 1.15}px`);
    drop.style.setProperty("--size", `${4 + (i % 3) * 2.5}px`);
  }
  for (let i = 0; i < DRIPS; i++) {
    const drip = div(splash, s.drip);
    drip.style.setProperty("--x", `${(i - (DRIPS - 1) / 2) * at.w * 0.17 + (i % 2 ? 4 : -3)}px`);
    drip.style.setProperty("--len", `${at.h * (0.22 + (i % 3) * 0.08)}px`);
    drip.style.setProperty("--d", `${i * 0.03}`);
  }

  // The bottle: thrown on an arc from the thrower's card, spinning, landing as the splash starts.
  if (from) {
    play("whoosh");
    const bottle = div(root, `${s.bottle} oil-bottle`);
    bottle.innerHTML = BOTTLE;
    const dx = from.x - at.x;
    const dy = from.y - at.y;
    // How high it's lobbed: a little with the distance, never up past the top bar.
    const room = Math.min(at.y, from.y) - 80;
    const arc = Math.max(40, Math.min(200, Math.hypot(dx, dy) * 0.22, room));
    const frames: Keyframe[] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = dx * (1 - t);
      const y = dy * (1 - t) - arc * 4 * t * (1 - t);
      frames.push({
        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${t * 2.2 * 360}deg) scale(${0.75 + 0.35 * Math.sin(Math.PI * t)})`,
        opacity: t < 0.06 ? t / 0.06 : 1,
      });
    }
    bottle.animate(frames, { duration: impact, easing: "linear", fill: "forwards" });
    window.setTimeout(() => bottle.remove(), impact);
  }

  return new Promise((done) => {
    window.setTimeout(() => {
      play("splat");
      o.release();
      document.querySelector(`[data-seat="${o.seat}"] .seat`)?.animate(
        [{ transform: "none" }, { transform: "translate(0, 3px) scale(0.985)" }, { transform: "none" }],
        { duration: 260 * k, easing: "ease-out" },
      );
    }, impact); // (the splash lands at the same moment with or without a bottle)
    window.setTimeout(() => {
      root.remove();
      done();
    }, total);
  });
}
