"""Per-player projections. The server only ever sends these, never the raw Game."""
from __future__ import annotations

from typing import Any

from .game import Game, Player
from .hero import skill_info
from .model import Role


def role_visible(game: Game, viewer: int, p: Player) -> bool:
    return game.result is not None or p.role == Role.LORD or p.seat == viewer or not p.alive


def view_for(game: Game, seat: int) -> dict[str, Any]:
    me = game.players[seat]
    return {
        "you": seat,
        "turn": game.turn_number,
        "current": game.current,
        "phase": str(game.phase) if game.phase else None,
        "draw_pile": len(game.draw_pile),
        "discard_pile": len(game.discard_pile),
        "processing": [c.to_dict() for c in game.processing],
        "attack_range": game.attack_range(me),
        "players": [
            {
                "seat": p.seat,
                "hero": p.hero,
                "kingdom": p.kingdom,
                "gender": p.gender,
                "skills": [skill_info(s) for s in p.skills if not s.lord or p.role == Role.LORD],
                "spent": sorted(k for k, v in p.marks.items() if v),  # limited used / awakened
                "skill_uses": {k: v for k, v in p.turn_usage.items() if not k.startswith("_")},
                # your distance to them (None for yourself or the dead)
                "distance": game.distance(seat, p.seat) if me.alive and p.alive and p.seat != seat else None,
                "hp": p.hp,
                "max_hp": p.max_hp,
                "alive": p.alive,
                "hand_count": len(p.hand),
                "equips": [c.to_dict() for c in p.equips],
                "judge": [c.to_dict() for c in p.judge],
                "role": str(p.role) if role_visible(game, seat, p) else None,
            }
            for p in game.players
        ],
        "hand": [c.to_dict() for c in me.hand],
        "result": (
            {"side": game.result.side, "winners": game.result.winners} if game.result else None
        ),
    }


def log_for(game: Game, seat: int | None, start: int = 0) -> list[dict[str, Any]]:
    """Log entries from `start`, with private details only for `seat` (None = spectator)."""
    out = []
    for entry in game.log[start:]:
        e = dict(entry)
        priv = e.pop("private", None)
        if priv is not None and seat in priv["seats"]:
            e.update(priv["data"])
        out.append(e)
    return out
