import { useEffect } from "react";

/*
 * Keyboard play. Buttons opt in with data-shortcut (see Button's `shortcut` prop), so the
 * key hint drawn on a button and the key that presses it can't drift apart.
 *   1-9      pick the Nth card in your hand
 *   Enter    the main action (Use / Play / Confirm / Yes)
 *   Esc      back out (Cancel, else Don't play / No / None)
 *   E        end your play phase
 */
export const KEY = { main: "Enter", back: "Escape", end: "e" } as const;

/** What a key does right now, or null. Pure DOM lookup, so it always matches the screen. */
export function shortcutTarget(key: string, root: ParentNode = document): HTMLElement | null {
  if (/^[1-9]$/.test(key)) {
    const card = root.querySelectorAll<HTMLElement>(".hand .card")[Number(key) - 1];
    return card?.classList.contains("clickable") ? card : null;
  }
  const k = key.length === 1 ? key.toLowerCase() : key;
  // Several buttons can share a key (Cancel and Don't play both back out): first one wins,
  // and the bar lists Cancel first.
  return root.querySelector<HTMLElement>(`.action-bar [data-shortcut="${k}"]:not(:disabled)`);
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      // Typing somewhere, or a dialog is open (hero pick, game over): not ours.
      if (el?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (document.querySelector("[role=dialog]")) return;
      // Enter on a focused button already presses that button.
      if (e.key === "Enter" && el?.closest?.("button")) return;
      const target = shortcutTarget(e.key);
      if (!target) return;
      e.preventDefault();
      target.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
