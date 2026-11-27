import { play } from "../sound";
import { fxSpeed } from "./stage";
import s from "./Missile.module.css";

/*
 * A Strike from Yilong Ma while he's launched (SpaceX, for the rest of that play phase): a missile streaks
 * from his hero card to the target's along a slight arc, nose turned along its path, leaving a
 * smoke trail, and explodes on the target's card: a flash, a fireball, a shock ring and smoke.
 *
 * Drawn on the effects layer; the flight is computed (Web Animations), the blast is CSS.
 */

/** Timings at speed 1 (ms). */
export const MISSILE = { flight: 620, blast: 650 } as const;

const TRAIL_GAP = 22; // px between the smoke puffs left along the way

function div(parent: HTMLElement, cls: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  parent.appendChild(e);
  return e;
}

const BODY = `<svg viewBox="0 0 60 16" width="100%" height="100%" aria-hidden="true">
  <defs>
    <linearGradient id="msBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f2f4f6"/><stop offset="0.5" stop-color="#b9c0c7"/><stop offset="1" stop-color="#6b737c"/>
    </linearGradient>
  </defs>
  <path d="M9 5 L3 0 L13 0 L17 5 Z M9 11 L3 16 L13 16 L17 11 Z" fill="#3a3f46"/>
  <rect x="6" y="5" width="42" height="6" rx="2.5" fill="url(#msBody)"/>
  <path d="M47 5 Q57 6 60 8 Q57 10 47 11 Z" fill="#d23a2a"/>
  <rect x="20" y="5" width="2" height="6" fill="#d23a2a" opacity="0.8"/>
</svg>`;

/** Where a seat's hero card is, in layer pixels. */
function centreOf(layer: HTMLElement, seat: number): { x: number; y: number } | null {
  const seatEl = document.querySelector(`[data-seat="${seat}"]`);
  const r = (seatEl?.querySelector(".hero-face") ?? seatEl)?.getBoundingClientRect();
  if (!r || !r.width) return null;
  const base = layer.getBoundingClientRect();
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1; // the interface size
  return { x: (r.left + r.width / 2 - base.left) / zoom, y: (r.top + r.height / 2 - base.top) / zoom };
}

/** Fire a missile from `from` to `to` after `delay` ms (several targets: one after another). */
export function missile(layer: HTMLElement, from: number, to: number, delay = 0): Promise<void> {
  const k = 1 / fxSpeed();
  const a = centreOf(layer, from);
  const b = centreOf(layer, to);
  if (!a || !b || from === to) {
    play("boom", delay / 1000);
    return Promise.resolve();
  }
  const flight = MISSILE.flight * k;
  const blast = MISSILE.blast * k;

  // A slight arc: the control point lifted off the straight line, to the upper side.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  if (ny > 0) [nx, ny] = [-nx, -ny]; // bow upwards
  const lift = Math.min(90, len * 0.18);
  const c = { x: mx + nx * lift, y: my + ny * lift };
  const at = (t: number) => ({
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y,
  });
  const heading = (t: number) => {
    const dx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
    const dy = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };

  const root = div(layer, `${s.missile} missile-fx`);
  root.style.setProperty("--flight", `${flight}ms`);
  root.style.setProperty("--blast", `${blast}ms`);
  root.style.setProperty("--wait", `${delay}ms`);

  // the smoke it leaves behind: each puff appears as the missile passes
  const ease = (u: number) => u ** 1.5; // it picks up speed
  const puffs = Math.max(8, Math.min(40, Math.round(len / TRAIL_GAP)));
  for (let i = 1; i <= puffs; i++) {
    const u = i / (puffs + 1);
    const p = at(ease(u));
    const puff = div(root, s.trail);
    Object.assign(puff.style, { left: `${p.x}px`, top: `${p.y}px` });
    puff.style.setProperty("--t", `${delay + u * flight}ms`);
  }

  const rocket = div(root, `${s.body} missile`);
  rocket.innerHTML = BODY;
  div(rocket, s.exhaust);
  const frames: Keyframe[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const t = ease(u);
    const p = at(t);
    frames.push({
      transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${heading(Math.min(t, 0.999))}deg) scale(${0.7 + 0.3 * Math.min(1, u * 3)})`,
      opacity: u === 0 ? 0 : 1,
    });
  }
  rocket.animate(frames, { duration: flight, delay, easing: "linear", fill: "both" });

  // the blast on the target's card
  const boom = div(root, `${s.boom} missile-boom`);
  Object.assign(boom.style, { left: `${b.x}px`, top: `${b.y}px` });
  div(boom, s.flash);
  div(boom, s.fireball);
  div(boom, s.ring);
  for (let i = 0; i < 4; i++) {
    const sm = div(boom, s.smoke);
    const ang = (i / 4) * Math.PI * 2 + 0.6;
    sm.style.setProperty("--dx", `${Math.cos(ang) * 26}px`);
    sm.style.setProperty("--dy", `${Math.sin(ang) * 18 - 14}px`);
  }

  play("missile", delay / 1000);
  return new Promise((done) => {
    window.setTimeout(() => {
      rocket.remove();
      play("boom");
      document.querySelector(`[data-seat="${to}"] .seat`)?.animate(
        [{ transform: "none" }, { transform: "translate(5px, -2px)" }, { transform: "translate(-4px, 2px)" }, { transform: "none" }],
        { duration: 300 * k, easing: "ease-out" },
      );
    }, delay + flight);
    window.setTimeout(() => {
      root.remove();
      done();
    }, delay + flight + blast);
  });
}
