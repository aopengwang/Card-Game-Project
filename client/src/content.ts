import { useSyncExternalStore } from "react";
import type { Card, Content, HeroInfo } from "./types";

export const SUIT_SYMBOL: Record<string, string> = { spade: "♠", heart: "♥", club: "♣", diamond: "♦", none: "" };
const RANKS: Record<number, string> = { 0: "", 1: "A", 11: "J", 12: "Q", 13: "K" };

export const KINGDOM_NAME: Record<string, string> = { wei: "Wei", shu: "Shu", wu: "Wu", qun: "Qun" };

let content: Content = { cards: {}, heroes: [] };
const listeners = new Set<() => void>();

export async function loadContent(): Promise<void> {
  try {
    const r = await fetch("/api/content");
    if (r.ok) {
      content = await r.json();
      listeners.forEach((l) => l());
    }
  } catch {
    /* offline: names fall back to ids */
  }
}

export function setContent(c: Content): void {
  content = c;
  listeners.forEach((l) => l());
}

export function useContent(): Content {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => content,
  );
}

export const rankText = (rank: number): string => RANKS[rank] ?? String(rank);

export const cardTitle = (name: string): string => content.cards[name]?.title ?? name;

export const heroInfo = (id: string): HeroInfo | undefined => content.heroes.find((h) => h.id === id);

export const isRed = (c: Card): boolean =>
  c.virtual ? c.color === "red" : c.suit === "heart" || c.suit === "diamond";

export function cardText(c: Card | undefined | null): string {
  if (!c) return "a card";
  if (c.virtual) return `${cardTitle(c.name)}`;
  return `${cardTitle(c.name)} ${SUIT_SYMBOL[c.suit]}${rankText(c.rank)}`;
}

export const titleCase = (id: string): string => id.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
