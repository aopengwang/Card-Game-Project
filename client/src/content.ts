import { useSyncExternalStore } from "react";
import { getLang, onLangChange, tMaybe } from "./i18n";
import type { Card, Content, HeroInfo } from "./types";

export const SUIT_SYMBOL: Record<string, string> = { spade: "♠", heart: "♥", club: "♣", diamond: "♦", none: "" };
const RANKS: Record<number, string> = { 0: "", 1: "A", 11: "J", 12: "Q", 13: "K" };

let content: Content = { cards: {}, heroes: [], skills: {} };
const listeners = new Set<() => void>();

/** Fetch names / rules text in the current language (again whenever it changes). */
export async function loadContent(): Promise<void> {
  const lang = getLang();
  try {
    const r = await fetch(`/api/content?lang=${lang}`);
    if (r.ok && getLang() === lang) setContent(await r.json());
  } catch {
    /* offline: names fall back to ids */
  }
}
onLangChange(() => void loadContent());

export function setContent(c: Content): void {
  content = { ...c, skills: c.skills ?? {} };
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

export const titleCase = (id: string): string => id.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

export const cardTitle = (name: string): string => content.cards[name]?.title ?? titleCase(name);

export const heroInfo = (id: string): HeroInfo | undefined => content.heroes.find((h) => h.id === id);

export const heroName = (id: string): string => heroInfo(id)?.name ?? id;

/** Localized skill name (works for skills gained mid-game too). */
export const skillTitle = (id: string): string => content.skills[id]?.title ?? titleCase(id);

/** Localized skill rules text, if the content for the current language has it. */
export const skillText = (id: string): string | undefined => content.skills[id]?.text || undefined;

/** Name for whatever caused a request: a card, a skill, or a game step. */
export function reasonTitle(reason: string): string {
  if (content.cards[reason]) return content.cards[reason].title;
  if (content.skills[reason]) return content.skills[reason].title ?? titleCase(reason);
  return tMaybe(`reason.${reason}`) ?? titleCase(reason);
}

/** One brush/seal character for a card, skill or hero (from its Chinese name). */
export function sealChar(kind: "card" | "skill" | "hero", id: string, which: "first" | "last" = "first"): string {
  const zh =
    kind === "card" ? content.cards[id]?.zh : kind === "skill" ? content.skills[id]?.zh : heroInfo(id)?.zh;
  const chars = Array.from(zh ?? "");
  if (chars.length === 0) return (kind === "card" ? cardTitle(id) : kind === "skill" ? skillTitle(id) : heroName(id)).slice(0, 1);
  return which === "first" ? chars[0] : chars[chars.length - 1];
}

export const cardInfo = (name: string) => content.cards[name];

export const roleName = (role: string): string => tMaybe(`role.${role}`) ?? titleCase(role);
export const kingdomName = (k: string): string => tMaybe(`kingdom.${k}`) ?? k;

export const isRed = (c: Card): boolean =>
  c.virtual ? c.color === "red" : c.suit === "heart" || c.suit === "diamond";

export function cardText(c: Card | undefined | null): string {
  if (!c) return tMaybe("log.aCard") ?? "a card";
  if (c.virtual) return cardTitle(c.name);
  return `${cardTitle(c.name)} ${SUIT_SYMBOL[c.suit]}${rankText(c.rank)}`;
}
