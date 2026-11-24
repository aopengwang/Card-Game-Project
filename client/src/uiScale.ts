import { useSyncExternalStore } from "react";

/*
 * Interface size: one number that scales the whole app (CSS zoom on #root, read by the
 * stylesheet as --ui-scale). "auto" sizes it from the window, so a big monitor gets a big
 * table; or the player picks a fixed size in Settings. Remembered per browser.
 *
 * Things drawn outside #root (dialogs, tooltips) apply --ui-scale to themselves. Code
 * that turns getBoundingClientRect() (zoomed, screen pixels) into CSS positions inside
 * #root must divide by the scale (see Effects.tsx).
 */
export const SCALE = { min: 0.8, max: 1.6, step: 0.05 } as const;
const KEY = "sgs.uiScale";

export type ScaleChoice = "auto" | number;

const clamp = (s: number) => Math.min(SCALE.max, Math.max(SCALE.min, s));
const round = (s: number) => Math.round(s / SCALE.step) * SCALE.step;

/** Auto: grow the table so the window looks like at least a 1440x900 one, never shrink. */
export function autoScale(windowW: number, windowH: number): number {
  const s = Math.min(windowW / 1440, windowH / 900);
  return Number(Math.max(1, Math.min(SCALE.max, round(s))).toFixed(2));
}

function load(): ScaleChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v && v !== "auto" && Number.isFinite(Number(v))) return clamp(Number(v));
  } catch {
    // storage blocked: use auto
  }
  return "auto";
}

let choice: ScaleChoice = load();
const listeners = new Set<() => void>();

export function currentScale(): number {
  return choice === "auto" ? autoScale(window.innerWidth, window.innerHeight) : choice;
}

let applied = 0;
function apply() {
  const s = currentScale();
  if (s === applied) return;
  applied = s;
  document.documentElement.style.setProperty("--ui-scale", String(s));
  listeners.forEach((l) => l());
}

export function getScaleChoice(): ScaleChoice {
  return choice;
}

export function setScaleChoice(next: ScaleChoice): void {
  choice = next === "auto" ? "auto" : Number(clamp(round(next)).toFixed(2));
  try {
    localStorage.setItem(KEY, String(choice));
  } catch {
    // not remembered, fine
  }
  applied = 0; // force listeners to re-read even if the number is unchanged
  apply();
}

/** Call once at startup: applies the saved size and keeps "auto" in step with the window. */
export function initScale(): void {
  apply();
  window.addEventListener("resize", () => choice === "auto" && apply());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The current scale; re-renders when it changes. */
export function useUiScale(): number {
  return useSyncExternalStore(subscribe, currentScale);
}

/** The player's choice ("auto" or a number); re-renders when it changes. */
export function useScaleChoice(): ScaleChoice {
  return useSyncExternalStore(subscribe, getScaleChoice);
}
