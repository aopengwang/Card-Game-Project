import { cardText, heroInfo, titleCase } from "./content";
import type { Card, LogEntry } from "./types";

export type Tone = "turn" | "damage" | "heal" | "death" | "skill" | "plain" | "end";

export interface LogLine {
  text: string;
  tone: Tone;
}

/** Human-readable text for a log entry (null = not worth showing). */
export function describe(e: LogEntry, name: (seat: number | null | undefined) => string): LogLine | null {
  const cards = (cs: Card[] | undefined) => (cs ?? []).map(cardText).join(", ");
  const to = (targets: number[] | undefined) => (targets?.length ? " → " + targets.map(name).join(", ") : "");
  const line = (text: string, tone: Tone = "plain"): LogLine => ({ text, tone });
  switch (e.type) {
    case "heroes_revealed":
      return line("Heroes: " + e.heroes.map((id: string, i: number) => `${name(i)} as ${heroInfo(id)?.name ?? id}`).join(", "), "skill");
    case "game_start":
      return line(`The game begins. ${name(e.lord)} is the Lord.`, "turn");
    case "turn_start":
      return line(`Turn ${e.turn}: ${name(e.seat)}`, "turn");
    case "draw":
      return line(`${name(e.seat)} draws ${e.count}${e.cards ? ": " + cards(e.cards) : ""}`);
    case "use":
      return line(`${name(e.seat)} uses ${cardText(e.card)}${e.subcards ? ` (from ${cards(e.subcards)})` : ""}${to(e.targets)}`);
    case "respond":
      return line(`${name(e.seat)} plays ${cardText(e.card)}${e.via ? ` via ${titleCase(e.via)}` : ""}`);
    case "skill":
      return line(`${name(e.seat)} uses ${titleCase(e.skill)}${to(e.targets)}`, "skill");
    case "skill_gained":
      return line(`${name(e.seat)} gains ${titleCase(e.skill)}`, "skill");
    case "equip":
      return line(`${name(e.seat)} equips ${cardText(e.card)}`);
    case "damage":
      return line(
        `${name(e.target)} takes ${e.amount}${e.nature !== "normal" ? ` ${e.nature}` : ""} damage` +
          `${e.source != null ? ` from ${name(e.source)}` : ""} (HP ${e.hp})`,
        "damage",
      );
    case "recover":
      return line(`${name(e.seat)} recovers ${e.amount} (HP ${e.hp})`, "heal");
    case "max_hp":
      return line(`${name(e.seat)}'s max HP ${e.delta > 0 ? "+" : ""}${e.delta} (now ${e.max_hp})`, "skill");
    case "dying":
      return line(`${name(e.seat)} is dying!`, "damage");
    case "death":
      return line(`${name(e.seat)} dies, revealed as ${titleCase(e.role)}`, "death");
    case "discard":
      return line(`${name(e.seat)} discards ${cards(e.cards)}`);
    case "judge_result":
      return line(`  Judgment for ${name(e.seat)}: ${cardText(e.card)} → ${e.hit ? "hit" : "miss"}`);
    case "nullify":
      return line(`  …nullified (${e.cancelled ? "cancelled" : "back on"})`, "skill");
    case "take":
      return line(
        `${name(e.seat)} takes ${e.card ? cardText(e.card) : e.cards ? cards(e.cards) : "a card"}` +
          `${e.target != null ? ` from ${name(e.target)}` : ""}`,
      );
    case "give":
      return line(`${name(e.seat)} gives ${e.card ? cardText(e.card) : "a card"} to ${name(e.target)}`);
    case "phase_skipped":
      return line(`${name(e.seat)} skips their ${e.phase} phase`);
    case "reveal":
      return line(`Revealed: ${cards(e.cards)}`);
    case "pick":
      return line(`${name(e.seat)} picks ${cardText(e.card)}`);
    case "lightning_moves":
      return line(`  Lightning moves to ${name(e.to)}`);
    case "rejudge":
      return line(`  ${name(e.seat)} rejudges → ${cardText(e.card)}`, "skill");
    case "blocked":
      return line(`  ${titleCase(e.reason)} blocks ${cardText(e.card)}`);
    case "prevented":
      return line(`  ${titleCase(e.reason)} prevents the damage`);
    case "borrowed_sword":
      return line(`  ${name(e.wielder)} must strike ${name(e.victim)} or hand over their weapon`);
    case "allure":
      return line(`  ${name(e.target)} must strike ${name(e.victim)}`);
    case "reshuffle":
      return line("The discard pile is shuffled into a new draw pile.");
    case "game_over":
      return line(`Game over: the ${titleCase(e.side)} side wins!`, "end");
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
    else if (e.type === "judge_result") out.push({ key: i, card: e.card, seat: e.seat, label: e.hit ? "judged: hit" : "judged: miss" });
  }
  return out.reverse();
}
