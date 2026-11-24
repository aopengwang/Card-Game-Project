"""Dump real game states as JSON fixtures for the client's component gallery.

    cd server
    python -m tools.dump_fixtures            # -> ../client/src/dev/fixtures/*.json

Each scenario plays hard-bot games (seeded, so the output is reproducible) until a
moment matching its predicate comes up, then saves exactly what that player's
client would hold at that moment: room info, view_for(), log_for() and the pending
request. The gallery renders these through the real UI, so designers can work on
"a Nullify chain" or "8 players, mid-game" without playing until it happens.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from bots import SmartBot
from content.standard import new_game
from engine import Game, Request
from engine.view import log_for, view_for
from net.protocol import request_to_dict

OUT = Path(__file__).resolve().parents[2] / "client" / "src" / "dev" / "fixtures"
NAMES = ["Mei", "Kai", "Ana", "Bo", "Lin", "Sam", "Yu", "Zoe"]

Match = Callable[[Game, Request], bool]


@dataclass
class Scenario:
    id: str
    title: str
    players: int
    match: Match | None  # None: play the game to the end and show the result
    watch: bool = False  # show it from another player's seat (they wait, no request)


def _names(req: Request, game: Game) -> list[str]:
    return [game.cards[o.card_id].name for o in getattr(req, "options", {}).values()] if req.kind == "play" else []


SCENARIOS: list[Scenario] = [
    Scenario("hero_pick", "Lord picks a hero", 5,
             lambda g, r: r.kind == "choose_hero" and r.seat == g.lord_seat),
    Scenario("play_strike", "Play phase with a Strike in hand", 6,
             lambda g, r: r.kind == "play" and g.turn_number >= 8 and "strike" in _names(r, g)
             and sum(len(p.equips) for p in g.players) >= 3),
    Scenario("play_skill", "Play phase with an active skill", 5,
             lambda g, r: r.kind == "play" and bool(r.skills) and g.turn_number >= 4),
    Scenario("respond_dodge", "Attacked: Dodge or take damage", 5,
             lambda g, r: r.kind == "respond" and r.card_name == "dodge" and r.reason == "strike"),
    Scenario("nullify_chain", "Nullify chain (counter-nullify)", 6,
             lambda g, r: r.kind == "respond" and r.card_name == "nullify" and bool(r.context.get("cancelled"))),
    Scenario("dying_self", "Dying: Peach to survive", 5,
             lambda g, r: r.kind == "respond" and r.card_name == "peach" and r.about == r.seat),
    Scenario("discard_phase", "Discard down to hand limit", 5,
             lambda g, r: r.kind == "discard" and r.reason == "discard_phase" and r.count >= 2),
    Scenario("choose_card", "Dismantle / Snatch: pick their card", 6,
             lambda g, r: r.kind == "choose_card" and r.reason in ("dismantle", "snatch") and bool(r.options)),
    Scenario("confirm_armor", "Eight Trigrams: judge for a Dodge?", 5,
             lambda g, r: r.kind == "confirm" and r.reason == "eight_trigrams"),
    Scenario("watching", "Someone else's turn (spectating your seat)", 7,
             lambda g, r: r.kind == "play" and g.turn_number >= 6, watch=True),
    Scenario("eight_players", "8 players, mid-game, someone fallen", 8,
             lambda g, r: r.kind == "play" and g.turn_number >= 14 and any(not p.alive for p in g.players)),
    Scenario("game_over", "Game over", 5, None),
]


def _room(game: Game, you: int, status: str) -> dict[str, Any]:
    members, bots = [], 0
    for i in range(len(game.players)):
        bot = i % 2 == 1 and i != you  # every other seat is a bot, never "you"
        if bot:
            bots += 1
        members.append({
            "name": f"Bot {bots}" if bot else NAMES[i],
            "bot": bot,
            "level": "hard" if bot else None,
            "connected": True,
        })
    return {
        "type": "room", "code": "DEMOS", "status": status, "you": you, "host": 0,
        "members": members, "min_players": 4, "max_players": 8, "bot_levels": ["easy", "hard"],
    }


def _fixture(sc: Scenario, game: Game, req: Request | None, seed: int) -> dict[str, Any]:
    if req is None:
        you = 0
    elif sc.watch:
        you = next(s for s in game.seats_from(req.seat)[1:] if game.players[s].alive)
    else:
        you = req.seat
    mine = req is not None and not sc.watch
    waiting = None
    if req is not None and sc.watch:
        waiting = {"seat": req.seat, "kind": req.kind}
    return {
        "id": sc.id,
        "title": sc.title,
        "seed": seed,
        "players": sc.players,
        "room": _room(game, you, "finished" if game.result else "playing"),
        "view": view_for(game, you),
        "log": log_for(game, you),
        "waiting": waiting,
        "request": {"id": 1, "req": request_to_dict(req), "timeout": 30} if mine else None,
    }


def capture(sc: Scenario, seeds: range = range(600)) -> dict[str, Any]:
    for seed in seeds:
        game = new_game(sc.players, seed, draft=True)
        bots = [SmartBot(seed * 10 + i) for i in range(sc.players)]
        gen = game.run()
        reply: Any = None
        try:
            while True:
                req = gen.send(reply)
                if sc.match is not None and sc.match(game, req):
                    return _fixture(sc, game, req, seed)
                reply = bots[req.seat](game, req)
        except StopIteration:
            if sc.match is None:
                return _fixture(sc, game, None, seed)
    raise RuntimeError(f"no seed produced scenario {sc.id!r}")


def dump(out: Path = OUT, only: list[str] | None = None) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for sc in SCENARIOS:
        if only and sc.id not in only:
            continue
        path = out / f"{sc.id}.json"
        path.write_text(json.dumps(capture(sc), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        written.append(path)
    return written


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("only", nargs="*", help="scenario ids (default: all)")
    args = ap.parse_args()
    for path in dump(args.out, args.only or None):
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
