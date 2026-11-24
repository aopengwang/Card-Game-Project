import { cardText, heroName, reasonTitle, roleName, skillTitle } from "./content";
import { joinList, t, tMaybe } from "./i18n";
import type { Card, LogEntry } from "./types";

export type Tone = "turn" | "damage" | "heal" | "death" | "skill" | "plain" | "end";

export interface LogLine {
  text: string;
  tone: Tone;
}

const sideName = (side: string) => tMaybe(`side.${side}`) ?? side;
const phaseName = (phase: string) => tMaybe(`phase.${phase}`) ?? phase;

/** Human-readable text for a log entry, in the current language (null = not worth showing). */
export function describe(e: LogEntry, name: (seat: number | null | undefined) => string): LogLine | null {
  const cards = (cs: Card[] | undefined) => joinList((cs ?? []).map(cardText));
  const to = (targets: number[] | undefined) => (targets?.length ? t("log.to", { targets: joinList(targets.map(name)) }) : "");
  const line = (text: string, tone: Tone = "plain"): LogLine => ({ text, tone });
  switch (e.type) {
    case "heroes_revealed":
      return line(
        t("log.heroes", { list: joinList(e.heroes.map((id: string, i: number) => t("log.heroAs", { name: name(i), hero: heroName(id) }))) }),
        "skill",
      );
    case "game_start":
      return line(t("log.gameStart", { name: name(e.lord) }), "turn");
    case "turn_start":
      return line(t("log.turn", { n: e.turn, name: name(e.seat) }), "turn");
    case "draw":
      return line(
        e.cards
          ? t("log.drawCards", { name: name(e.seat), n: e.count, cards: cards(e.cards) })
          : t("log.draw", { name: name(e.seat), n: e.count }),
      );
    case "use": {
      const base = e.subcards
        ? t("log.useFrom", { name: name(e.seat), card: cardText(e.card), cards: cards(e.subcards) })
        : t("log.use", { name: name(e.seat), card: cardText(e.card) });
      return line(base + to(e.targets));
    }
    case "respond":
      return line(
        e.via
          ? t("log.respondVia", { name: name(e.seat), card: cardText(e.card), via: reasonTitle(e.via) })
          : t("log.respond", { name: name(e.seat), card: cardText(e.card) }),
      );
    case "skill":
      return line(t("log.skill", { name: name(e.seat), skill: skillTitle(e.skill) }) + to(e.targets), "skill");
    case "skill_gained":
      return line(t("log.skillGained", { name: name(e.seat), skill: skillTitle(e.skill) }), "skill");
    case "equip":
      return line(t("log.equip", { name: name(e.seat), card: cardText(e.card) }));
    case "damage": {
      const nature = e.nature !== "normal" ? tMaybe(`nature.${e.nature}`) ?? e.nature : null;
      const params = { name: name(e.target), n: e.amount, hp: e.hp, source: name(e.source), nature: nature ?? "" };
      const key =
        e.source != null
          ? nature
            ? "log.damageNatureFrom"
            : "log.damageFrom"
          : nature
            ? "log.damageNature"
            : "log.damage";
      return line(t(key, params), "damage");
    }
    case "recover":
      return line(t("log.recover", { name: name(e.seat), n: e.amount, hp: e.hp }), "heal");
    case "max_hp":
      return line(t("log.maxHp", { name: name(e.seat), delta: e.delta > 0 ? `+${e.delta}` : e.delta, max: e.max_hp }), "skill");
    case "dying":
      return line(t("log.dying", { name: name(e.seat) }), "damage");
    case "death":
      return line(t("log.death", { name: name(e.seat), role: roleName(e.role) }), "death");
    case "discard":
      return line(t("log.discard", { name: name(e.seat), cards: cards(e.cards) }));
    case "judge_result":
      return line(t("log.judge", { name: name(e.seat), card: cardText(e.card), result: t(e.hit ? "act.hit" : "act.miss") }));
    case "nullify":
      return line(t(e.cancelled ? "log.nullifyCancelled" : "log.nullifyRestored"), "skill");
    case "take": {
      const what = e.card ? cardText(e.card) : e.cards ? cards(e.cards) : t("log.aCard");
      return line(
        e.target != null
          ? t("log.takeFrom", { name: name(e.seat), what, target: name(e.target) })
          : t("log.take", { name: name(e.seat), what }),
      );
    }
    case "give":
      return line(t("log.give", { name: name(e.seat), what: e.card ? cardText(e.card) : t("log.aCard"), target: name(e.target) }));
    case "phase_skipped":
      return line(t("log.skip", { name: name(e.seat), phase: phaseName(e.phase) }));
    case "reveal":
      return line(t("log.reveal", { cards: cards(e.cards) }));
    case "pick":
      return line(t("log.pick", { name: name(e.seat), card: cardText(e.card) }));
    case "lightning_moves":
      return line(t("log.lightning", { name: name(e.to) }));
    case "rejudge":
      return line(t("log.rejudge", { name: name(e.seat), card: cardText(e.card) }), "skill");
    case "blocked":
      return line(t("log.blocked", { reason: reasonTitle(e.reason), card: cardText(e.card) }));
    case "prevented":
      return line(t("log.prevented", { reason: reasonTitle(e.reason) }));
    case "borrowed_sword":
      return line(t("log.borrowed", { wielder: name(e.wielder), victim: name(e.victim) }));
    case "lose_hp":
      return line(t("log.loseHp", { name: name(e.seat), n: e.amount, hp: e.hp }), "damage");
    case "redirect":
      return line(t("log.redirect", { name: name(e.seat), card: cardText(e.card), target: name(e.target) }), "skill");
    case "arrange":
      return line(t("log.arrange", { name: name(e.seat), top: e.top, bottom: e.bottom }));
    case "named_suit":
      return line(t("log.namedSuit", { name: name(e.seat), suit: tMaybe(`opt.${e.suit}`) ?? e.suit }));
    case "reshuffle":
      return line(t("log.reshuffle"));
    case "game_over":
      return line(t("log.gameOver", { side: sideName(e.side) }), "end");
    default:
      return null;
  }
}

/** Card faces worth showing on the table: recent uses/responses/judgments, newest last. */
export function recentPlays(log: LogEntry[], limit = 6): { key: number; card: Card; seat: number | null; label: string }[] {
  const out: { key: number; card: Card; seat: number | null; label: string }[] = [];
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = log[i];
    if (e.type === "turn_start") break;
    if (e.type === "use" || e.type === "respond") out.push({ key: i, card: e.card, seat: e.seat, label: e.type });
    else if (e.type === "judge_result") out.push({ key: i, card: e.card, seat: e.seat, label: e.hit ? "hit" : "miss" });
  }
  return out.reverse();
}
