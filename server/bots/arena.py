"""Pit bot levels against each other and report win rates.

    python -m bots.arena --games 400 --players 5

Each line-up decides which bot level plays each team (Lord side = Lord + Loyalists).
Same seeds for every line-up, so differences come from the bots, not the deal.
"""
from __future__ import annotations

import argparse
from collections import Counter

from content.standard import new_game
from engine import Role
from engine.driver import play_game

from . import make_bot

TEAM = {Role.LORD: "lord", Role.LOYALIST: "lord", Role.REBEL: "rebel", Role.SPY: "spy"}


def run(lineup: dict[str, str], games: int, players: int, seed0: int = 0, draft: bool = True) -> Counter:
    """lineup maps team ("lord" / "rebel" / "spy") to bot level. Returns wins per side."""
    wins: Counter = Counter()
    for i in range(games):
        seed = seed0 + i
        g = new_game(players, seed, draft=draft)
        bots = [make_bot(lineup[TEAM[p.role]], seed * 31 + p.seat) for p in g.players]
        result = play_game(g, bots)
        wins[result.side] += 1
    return wins


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=300)
    ap.add_argument("--players", type=int, default=5)
    args = ap.parse_args()
    lineups = {
        "all easy": {"lord": "easy", "rebel": "easy", "spy": "easy"},
        "all hard": {"lord": "hard", "rebel": "hard", "spy": "hard"},
        "hard Lord side": {"lord": "hard", "rebel": "easy", "spy": "easy"},
        "hard Rebels": {"lord": "easy", "rebel": "hard", "spy": "easy"},
        "hard Spy": {"lord": "easy", "rebel": "easy", "spy": "hard"},
    }
    print(f"{args.games} games x {args.players} players (Lord side / Rebels / Spy / draw win %)")
    for name, lineup in lineups.items():
        w = run(lineup, args.games, args.players)
        pct = {k: 100 * w[k] / args.games for k in ("lord", "rebel", "spy", "draw")}
        print(f"  {name:16s} {pct['lord']:5.1f} / {pct['rebel']:5.1f} / {pct['spy']:5.1f} / {pct['draw']:4.1f}")


if __name__ == "__main__":
    main()
