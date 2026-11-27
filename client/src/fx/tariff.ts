import { play } from "../sound";
import { fxSpeed } from "./stage";
import s from "./Tariff.module.css";

/*
 * Tariffs: a giant seal stamp drops out of the sky onto the tariffed player's hero card. It
 * tilts and grows as it falls (CSS 3D: perspective + rotateX), its shadow gathers under it,
 * and on impact it squashes, dust flies, the seat shakes and a thud + a cash-register ching
 * play. Then it lifts away and leaves a red 税 imprint, which fades as the seat's Tariff chip
 * (held back until now) takes over.
 *
 * Drawn on the effects layer; the table itself never moves.
 */

/** Timings at speed 1 (ms); `impact` is when the stamp lands (fraction of `total`). */
export const TARIFF = { total: 2000, impact: 0.62 } as const;

const DUST = 8; // specks thrown out on impact

function div(parent: HTMLElement, cls: string, text?: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/**
 * Keep the seat's Tariff chip out of sight until the stamp lands (call before the new view
 * paints). Returns the release.
 */
export function holdTariff(seat: number): () => void {
  const el = document.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
  if (!el) return () => {};
  el.dataset.fxTariff = "";
  let done = false;
  return () => {
    if (done) return;
    done = true;
    delete el.dataset.fxTariff;
  };
}

export interface TariffShow {
  seat: number;
  /** "Tariff" / "关税", under the 税 on the imprint. */
  label: string;
  /** Shows the seat's chip (from holdTariff). */
  release: () => void;
}

export function tariffStamp(layer: HTMLElement, t: TariffShow): Promise<void> {
  const k = 1 / fxSpeed();
  const seatEl = document.querySelector(`[data-seat="${t.seat}"]`);
  const face = seatEl?.querySelector(".hero-face") ?? seatEl;
  const base = layer.getBoundingClientRect();
  const r = face?.getBoundingClientRect();
  if (!r || !r.width) {
    t.release();
    play("tariff");
    return Promise.resolve();
  }
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1; // the interface size
  const x = (r.left + r.width / 2 - base.left) / zoom;
  const y = (r.top + r.height / 2 - base.top) / zoom;
  const w = Math.min(150, Math.max(80, (r.width / zoom) * 0.95));
  const total = TARIFF.total * k;

  const root = div(layer, `${s.tariff} tariff-fx`);
  Object.assign(root.style, { left: `${x}px`, top: `${y}px` });
  root.style.setProperty("--life", `${total}ms`);
  root.style.setProperty("--w", `${w}px`);
  // From well above the top of the table, whatever the seat's height.
  root.style.setProperty("--fall", `${y + w * 1.6 + 60}px`);

  div(root, s.shadow);
  const imprint = div(root, `${s.imprint} tariff-imprint`);
  const mark = div(imprint, s.mark, "税");
  mark.lang = "zh-CN";
  div(imprint, s.label, t.label);
  div(root, s.ring);
  for (let i = 0; i < DUST; i++) {
    const a = (i / DUST) * Math.PI * 2 + 0.3;
    const d = w * (0.55 + (i % 3) * 0.12);
    const speck = div(root, s.dust);
    speck.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    speck.style.setProperty("--dy", `${Math.sin(a) * d * 0.45}px`); // flat: it skids across the table
  }

  // The stamp itself: a knob, a neck and a wooden block with the inked seal underneath.
  const scene = div(root, s.scene);
  const stamp = div(scene, `${s.stamp} tariff-stamp`);
  div(stamp, s.knob);
  div(stamp, s.neck);
  const block = div(stamp, s.block);
  const side = div(block, s.blockMark, "税");
  side.lang = "zh-CN";
  div(stamp, s.pad);

  return new Promise((done) => {
    window.setTimeout(() => {
      play("tariff");
      t.release();
      seatEl?.querySelector(".seat")?.animate(
        [
          { transform: "none" },
          { transform: "translate(0, 6px) scale(0.97)" },
          { transform: "translate(-3px, -2px)" },
          { transform: "translate(2px, 1px)" },
          { transform: "none" },
        ],
        { duration: 420 * k, easing: "ease-out" },
      );
    }, total * TARIFF.impact);
    window.setTimeout(() => {
      root.remove();
      done();
    }, total);
  });
}
