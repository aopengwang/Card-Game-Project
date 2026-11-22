"""Event names and the skill interfaces (heroes and equipment plug in here).

Every skill derives from SkillBase, which carries passive modifiers (range,
distance, hand limit, targeting restrictions...). On top of that:

- Skill:       triggered; reacts to Events.
- ViewAs:      conversion; use/play some cards *as* another card.
- ActiveSkill: used on purpose during your play phase (cost cards, pick targets).

Skills are stateless singletons; per-player state lives in Player.turn_usage
(reset at the start of every turn) and Player.marks (whole game).
"""
from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Any

from .model import Gen

if TYPE_CHECKING:
    from .game import Game, Player


class Event(StrEnum):
    TURN_START = "turn_start"
    TURN_END = "turn_end"
    PHASE_START = "phase_start"  # data: Phase (the current player is game.current)
    PHASE_END = "phase_end"
    DRAW_PHASE = "draw_phase"  # data: DrawCount (mutable .count)
    CARD_USED = "card_used"  # data: CardUse
    TARGET_CONFIRMED = "target_confirmed"  # data: (CardUse, target_seat)
    CARD_FINISHED = "card_finished"  # data: CardUse
    CARD_RESPONDED = "card_responded"  # data: (seat, Card)
    STRIKE_DODGED = "strike_dodged"  # data: (CardUse, target_seat); add target to use.data["forced"] to hit anyway
    CARDS_MOVED = "cards_moved"  # data: CardsMoved
    DAMAGE_CAUSED = "damage_caused"  # data: Damage (source side may modify)
    DAMAGE_INFLICTED = "damage_inflicted"  # data: Damage (target side may modify)
    DAMAGED = "damaged"  # data: Damage (after HP loss, if survived)
    RECOVERED = "recovered"  # data: (seat, amount)
    JUDGE_CARD = "judge_card"  # data: Judgment (skills may swap .card here)
    JUDGE_RESULT = "judge_result"  # data: Judgment (.hit decided)
    DYING = "dying"  # data: seat
    DEATH = "death"  # data: (seat, Damage | None)


class SkillBase:
    name: str = ""  # unique content id
    locked: bool = False  # mandatory / always on (display + bot hint)
    lord: bool = False  # only works while the owner is the Lord
    limited: bool = False  # usable once per game
    awakening: bool = False  # fires once when its condition is met, then is spent
    per_turn: int | None = None  # max uses per turn (ViewAs / ActiveSkill)
    events: tuple[Event, ...] = ()

    # ---- passive modifiers (summed over all of a player's skills and equipment)

    def attack_range_bonus(self, game: Game, owner: Player) -> int:
        return 0

    def distance_out(self, game: Game, owner: Player) -> int:
        """Added to the owner's distance to everyone else."""
        return 0

    def distance_in(self, game: Game, owner: Player) -> int:
        """Added to everyone else's distance to the owner."""
        return 0

    def extra_strikes(self, game: Game, owner: Player) -> int:
        return 0

    def hand_limit_bonus(self, game: Game, owner: Player) -> int:
        return 0

    def can_be_targeted(self, game: Game, owner: Player, card_name: str, user: Player) -> bool:
        """False forbids `user` from choosing the owner as a target of `card_name`."""
        return True

    # ---- response assists: provide a card (e.g. a Dodge) without playing one from hand

    assists: frozenset[str] = frozenset()  # card names `assist` can provide

    def assist(self, game: Game, owner: Player, card_name: str, reason: str, about: int | None) -> Gen:
        """Offer to provide `card_name`. Return a (virtual) Card, or None to fall through."""
        return None
        yield  # pragma: no cover  (makes this a generator)


class Skill(SkillBase):
    """A triggered ability. Owners' skills fire in seat order from the current player."""

    def can_trigger(self, game: Game, owner: Player, event: Event, data: Any) -> bool:
        return True

    def on_trigger(self, game: Game, owner: Player, event: Event, data: Any) -> Gen:
        yield from ()


class ViewAs(SkillBase):
    """A conversion: the owner may use/play `count` of their cards as a card named `as_name`.

    Heroes ("use two same-suit cards as X") and equipment (two hand cards as a
    Strike) both plug in here. The engine turns the chosen cards into a
    virtual card; the physical cards are the CardUse's `subcards`.
    """

    as_name: str = ""
    count: int = 1
    in_play: bool = True  # usable during your play phase
    in_response: bool = True  # usable when asked to play `as_name`

    def cards(self, game: Game, owner: Player) -> list[int]:
        """Card ids that may be spent on this conversion."""
        return [c.id for c in owner.hand]

    def enabled(self, game: Game, owner: Player) -> bool:
        return True

    def check(self, game: Game, owner: Player, cards: list[int]) -> str | None:
        """Extra rule for the chosen cards (e.g. "same suit"). Return an error or None."""
        return None


class ActiveSkill(SkillBase):
    """Used during the owner's play phase. Defaults to once per turn."""

    per_turn: int | None = 1
    harmful: bool = True  # hint for bots / UI: aimed at enemies?
    min_cards: int = 0
    max_cards: int = 0
    min_targets: int = 0
    max_targets: int = 0

    def can_activate(self, game: Game, owner: Player) -> bool:
        return True

    def card_options(self, game: Game, owner: Player) -> list[int]:
        return [c.id for c in owner.hand]

    def target_options(self, game: Game, owner: Player) -> list[int]:
        return []

    def check(self, game: Game, owner: Player, cards: list[int], targets: list[int]) -> str | None:
        """Extra rule for a chosen combination. Return an error or None."""
        return None

    def activate(self, game: Game, owner: Player, cards: list[int], targets: list[int]) -> Gen:
        yield from ()
