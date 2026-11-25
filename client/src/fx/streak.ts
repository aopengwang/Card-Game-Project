import { playStreak } from "../sound";
import type { LogEntry } from "../types";
import { fxSpeed } from "./stage";
import s from "./Streak.module.css";

/*
 * Kill streaks: from a player's second kill of the game, a banner sweeps across the table
 * ("Double Kill" ... "Unstoppable" at seven, the most an 8-player game allows), growing
 * fiercer with each kill, with a drum roll of one beat per kill and a gong.
 */

export const MAX_STREAK = 7;

/** The killer's kill count at the death entry `log[index]` (0 if it isn't a kill). */
export function streakAt(log: LogEntry[], index: number): number {
  const e = log[index];
  if (e?.type !== "death" || typeof e.killer !== "number" || e.killer === e.seat) return 0;
  let n = 0;
  for (let i = 0; i <= index; i++) {
    const d = log[i];
    if (d.type === "death" && d.killer === e.killer && d.killer !== d.seat) n++;
  }
  return Math.min(n, MAX_STREAK);
}

/** Total length of the banner at speed 1 (ms); a little longer the higher the streak. */
export const streakLength = (level: number) => 1700 + 150 * level;

function el(parent: HTMLElement, cls: string, text?: string): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

/** Play the banner for a `level`-kill streak by `who` on the effects layer. */
export function killStreak(layer: HTMLElement, level: number, title: string, who: string, zh: boolean): Promise<void> {
  const k = 1 / fxSpeed();
  const total = streakLength(level) * k;
  const root = el(layer, `${s.streak} ${s[`l${level}`] ?? ""} kill-streak`);
  root.dataset.level = String(level);
  root.style.setProperty("--life", `${total}ms`);
  root.style.setProperty("--beat", `${110 * k}ms`);
  el(root, s.flash);
  const band = el(root, s.band);
  const titleEl = el(band, `${s.title} streak-title`, title);
  if (zh) titleEl.lang = "zh-CN";
  el(band, s.who, who);
  const marks = el(band, s.marks);
  for (let i = 0; i < level; i++) {
    const m = el(marks, s.mark);
    m.style.animationDelay = `${(260 + i * 110) * k}ms`;
  }
  playStreak(level);
  return new Promise((done) =>
    window.setTimeout(() => {
      root.remove();
      done();
    }, total),
  );
}
