from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .events import SkillBase
from .hero import Hero
from .model import Card, CardDef


@dataclass(frozen=True)
class Ruleset:
    """Content plugged into the engine: card rules, how to build the deck, heroes."""

    name: str
    card_defs: dict[str, CardDef]
    build_deck: Callable[[], list[Card]]
    heroes: dict[str, Hero] = field(default_factory=dict)
    # token name -> a skill every player carrying that token has (e.g. a "slippery" marker)
    statuses: dict[str, SkillBase] = field(default_factory=dict)
