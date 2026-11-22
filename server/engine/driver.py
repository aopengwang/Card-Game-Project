"""Synchronous driver: runs an engine generator, answering Requests via a callback.

Used by tests, bots and the CLI sim. The network server will have an async
equivalent that waits on websockets (with timeouts -> req.default()).
"""
from __future__ import annotations

from typing import Any, Callable, Sequence

from .game import Game
from .model import GameResult, Gen
from .requests import Request

Agent = Callable[[Game, Request], Any]


class InvalidAnswer(Exception):
    pass


def drive(gen: Gen, answer: Callable[[Request], Any], max_steps: int = 100_000) -> Any:
    reply: Any = None
    for _ in range(max_steps):
        try:
            req = gen.send(reply)
        except StopIteration as stop:
            return stop.value
        if req.error:
            raise InvalidAnswer(f"seat {req.seat}: {req.error}")
        reply = answer(req)
    raise RuntimeError("step limit exceeded")


def play_game(game: Game, agents: Sequence[Agent]) -> GameResult:
    return drive(game.run(), lambda req: agents[req.seat](game, req))
