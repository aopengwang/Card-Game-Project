"""Watch a bot-only game in the terminal.

    python sim.py --players 5 --seed 42
"""
from __future__ import annotations

import argparse
import sys

from bots import SimpleBot
from content.heroes import HERO_MAP
from content.names import CARD_NAMES
from content.standard import new_game
from engine.driver import play_game

SUITS = {"spade": "♠", "heart": "♥", "club": "♣", "diamond": "♦", "none": ""}
RANKS = {0: "", 1: "A", 11: "J", 12: "Q", 13: "K"}
NAMES = CARD_NAMES


def hero(hero_id: str) -> str:
    h = HERO_MAP.get(hero_id)
    return f"{h.name} ({h.kingdom}, {h.max_hp} HP)" if h else hero_id


def skill(skill_id: str) -> str:
    return skill_id.replace("_", " ").title()


def card(c: dict) -> str:
    if c.get("virtual"):
        return f"{NAMES.get(c['name'], c['name'])} (virtual, {c['color']})"
    return f"{NAMES.get(c['name'], c['name'])} {SUITS[c['suit']]}{RANKS.get(c['rank'], c['rank'])}"


def describe(e: dict) -> str | None:
    t = e["type"]
    match t:
        case "game_start":
            lines = [f"Game start: {e['players']} players. P{e['lord']} is the Lord ({e['lord_hp']} HP)."]
            lines += [f"  P{i}: {hero(h)}" for i, h in enumerate(e.get("heroes", []))]
            return "\n".join(lines)
        case "skill":
            tgt = " -> " + ", ".join(f"P{s}" for s in e["targets"]) if e.get("targets") else ""
            return f"P{e['seat']} [{skill(e['skill'])}]{tgt}"
        case "skill_gained":
            return f"P{e['seat']} gains [{skill(e['skill'])}]"
        case "max_hp":
            return f"P{e['seat']} max HP {e['delta']:+d} -> {e['max_hp']}"
        case "give":
            return f"P{e['seat']} gives a card to P{e['target']}"
        case "rejudge":
            return f"  P{e['seat']} rejudges {card(e['old'])} -> {card(e['card'])}"
        case "allure":
            return f"  P{e['target']} must strike P{e['victim']}"
        case "turn_start":
            return f"\n--- Turn {e['turn']}: P{e['seat']} ---"
        case "draw":
            shown = ", ".join(card(c) for c in e["private"]["data"]["cards"])
            return f"P{e['seat']} draws {e['count']} ({e['reason']}): {shown}"
        case "use":
            tgt = " -> " + ", ".join(f"P{s}" for s in e["targets"]) if e["targets"] else ""
            return f"P{e['seat']} uses {card(e['card'])}{tgt}"
        case "respond":
            via = f" via {NAMES.get(e['via'], e['via'])}" if "via" in e else ""
            return f"P{e['seat']} responds with {card(e['card'])}{via}"
        case "equip":
            return f"P{e['seat']} equips {card(e['card'])}"
        case "borrowed_sword":
            return f"  P{e['wielder']} must strike P{e['victim']} or hand over their weapon"
        case "prevented":
            return f"  {NAMES.get(e['reason'], e['reason'])} prevents the damage to P{e['target']}"
        case "blocked":
            return f"  {NAMES.get(e['reason'], e['reason'])} blocks {card(e['card'])} on P{e['seat']}"
        case "nullify":
            state = "cancelled" if e["cancelled"] else "back on"
            return f"  -> {NAMES.get(e['card']['name'])} on P{e['target']} is {state}"
        case "take":
            what = card(e["private"]["data"]["card"]) if "private" in e else card(e["card"])
            return f"P{e['seat']} takes {what} from P{e['target']}"
        case "reveal":
            return "Revealed: " + ", ".join(card(c) for c in e["cards"])
        case "pick":
            return f"P{e['seat']} picks {card(e['card'])}"
        case "delayed":
            return f"P{e['seat']} must resolve {card(e['card'])}"
        case "judge_result":
            return f"  Judgment for P{e['seat']}: {card(e['card'])} -> {'HIT' if e['hit'] else 'miss'}"
        case "lightning_moves":
            return f"  Lightning moves from P{e['seat']} to P{e['to']}"
        case "phase_skipped":
            return f"P{e['seat']} skips their {e['phase']} phase"
        case "damage":
            src = f" from P{e['source']}" if e["source"] is not None else ""
            kind = f" {e['nature']}" if e["nature"] != "normal" else ""
            return f"P{e['target']} takes {e['amount']}{kind} damage{src} (HP {e['hp']})"
        case "recover":
            return f"P{e['seat']} recovers {e['amount']} (HP {e['hp']})"
        case "dying":
            return f"P{e['seat']} is dying!"
        case "death":
            by = f" (killed by P{e['killer']})" if e["killer"] is not None else ""
            return f"P{e['seat']} dies, revealed as {e['role'].upper()}{by}"
        case "discard":
            return f"P{e['seat']} discards ({e['reason']}): " + ", ".join(card(c) for c in e["cards"])
        case "reshuffle":
            return "Discard pile reshuffled into the draw pile."
        case "game_over":
            roles = ", ".join(f"P{i}={r}" for i, r in enumerate(e["roles"]))
            return f"\nGAME OVER: {e['side'].upper()} side wins {e['winners']}\nRoles: {roles}"
    return None


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", type=int, default=5)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    game = new_game(args.players, args.seed, draft=True)
    play_game(game, [SimpleBot(args.seed * 100 + i) for i in range(args.players)])
    for e in game.log:
        line = describe(e)
        if line:
            print(line)


if __name__ == "__main__":
    main()
