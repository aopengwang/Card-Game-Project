from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .hero import Hero
from .model import Card, CardDef


@dataclass(frozen=True)
class Ruleset:
    """Content plugged into the engine: card rules, how to build the deck, heroes."""

    name: str
    card_defs: dict[str, CardDef]
    build_deck: Callable[[], list[Card]]
    heroes: dict[str, Hero] = field(default_factory=dict)
