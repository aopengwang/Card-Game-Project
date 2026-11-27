import { play } from "../sound";
import { fxSpeed } from "./stage";
import s from "./Aura.module.css";

/*
 * The Chairman's aura (气场).
 *  - "small" (Aura Farmer earns a token): a glowing halo traces his hero card and gold-to-
 *    violet wisps and sparks drift up off it.
 *  - "big" (Do Nothing, Win spends one): the table dims around him, a shockwave rings out, a
 *    sunburst turns behind the card, a crown of aura flames flickers up around it, wisps and
 *    sparks pour off, and the skill's name rises in glowing brush strokes.
 * The glow is drawn with `mix-blend-mode: screen` so the card stays visible through it.
 */

export type AuraSize = "small" | "big";

/** Lengths at speed 1 (ms). */
export const AURA = { small: 1200, big: 2400 } as const;

const COUNT = {
  small: { wisps: 7, sparks: 6, flames: 0 },
  big: { wisps: 14, sparks: 16, flames: 14 },
} as const;

function div(parent: HTMLElement, cls: string, text?: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/**
 * @param title the skill's name, shown rising over the card in the big aura
 * @param zh    show it in brush characters
 */
export function aura(layer: HTMLElement, seat: number, size: AuraSize, title = "", zh = false): Promise<void> {
  const k = 1 / fxSpeed();
  const seatEl = document.querySelector(`[data-seat="${seat}"]`);
  const face = seatEl?.querySelector(".hero-face") ?? seatEl;
  const base = layer.getBoundingClientRect();
  const r = face?.getBoundingClientRect();
  if (!r || !r.width) {
    play(size === "big" ? "auraBig" : "aura");
    return Promise.resolve();
  }
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1; // the interface size
  const w = r.width / zoom;
  const h = r.height / zoom;
  const total = AURA[size] * k;

  const root = div(layer, `${s.aura} aura-fx`);
  root.dataset.size = size;
  Object.assign(root.style, { left: `${(r.left + r.width / 2 - base.left) / zoom}px`, top: `${(r.top + r.height / 2 - base.top) / zoom}px` });
  root.style.setProperty("--life", `${total}ms`);
  root.style.setProperty("--w", `${w}px`);
  root.style.setProperty("--h", `${h}px`);

  if (size === "big") div(root, s.vignette); // (darkens: outside the glow's screen blend)
  const glow = div(root, s.glow);
  if (size === "big") {
    div(glow, s.rays);
    div(glow, s.shock);
    const n = COUNT.big.flames;
    for (let i = 0; i < n; i++) {
      // a fan of flames, tallest in the middle: the aura's silhouette around the card
      const t = i / (n - 1);
      const f = div(glow, s.flame);
      f.style.setProperty("--x", `${(t - 0.5) * w * 1.15}px`);
      f.style.setProperty("--fh", `${h * (0.55 + 0.6 * Math.sin(Math.PI * t))}px`);
      f.style.setProperty("--tilt", `${(t - 0.5) * 30}deg`);
      f.style.setProperty("--flick", `${(0.9 + (i % 3) * 0.35).toFixed(2)}`); // flicker speed
    }
  }
  div(glow, s.halo);
  const { wisps, sparks } = COUNT[size];
  for (let i = 0; i < wisps; i++) {
    const wisp = div(glow, s.wisp);
    wisp.style.setProperty("--x", `${((i + 0.5) / wisps - 0.5) * w * 0.95}px`);
    wisp.style.setProperty("--d", `${((i * 7) % wisps) / wisps * 0.25}`); // staggered starts (× life)
    wisp.style.setProperty("--rise", `${h * (0.45 + (i % 3) * 0.12)}px`);
  }
  for (let i = 0; i < sparks; i++) {
    const sp = div(glow, s.spark);
    sp.style.setProperty("--x", `${(((i * 37) % 100) / 100 - 0.5) * w * 1.1}px`);
    sp.style.setProperty("--d", `${((i * 13) % sparks) / sparks * 0.4}`);
    sp.style.setProperty("--rise", `${h * (0.55 + (i % 4) * 0.12)}px`);
    sp.style.setProperty("--drift", `${(i % 2 ? 1 : -1) * (6 + (i % 5) * 4)}px`);
  }
  if (size === "big" && title) {
    const name = div(glow, `${s.title} aura-title`, title);
    if (zh) name.lang = "zh-CN";
  }

  play(size === "big" ? "auraBig" : "aura");
  return new Promise((done) => {
    window.setTimeout(() => {
      root.remove();
      done();
    }, total);
  });
}
