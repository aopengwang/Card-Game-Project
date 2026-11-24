"""Core value types shared by the whole engine."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Callable, Generator

if TYPE_CHECKING:
    from .game import Game, Player
    from .requests import Request

# Every engine action that may need player input is a generator that yields
# Requests and receives the player's answer back via send().
Gen = Generator["Request", Any, Any]


class Suit(StrEnum):
    SPADE = "spade"
    HEART = "heart"
    CLUB = "club"
    DIAMOND = "diamond"
    NONE = "none"  # virtual cards made from mixed suits (or from no cards)

    @property
    def is_red(self) -> bool:
        return self in (Suit.HEART, Suit.DIAMOND)

    @property
    def is_black(self) -> bool:
        return self in (Suit.SPADE, Suit.CLUB)


class CardType(StrEnum):
    BASIC = "basic"
    TRICK = "trick"
    EQUIPMENT = "equipment"


class Role(StrEnum):
    LORD = "lord"
    LOYALIST = "loyalist"
    REBEL = "rebel"
    SPY = "spy"


class Phase(StrEnum):
    START = "start"
    JUDGE = "judge"
    DRAW = "draw"
    PLAY = "play"
    DISCARD = "discard"
    END = "end"


class Zone(StrEnum):
    DRAW_PILE = "draw_pile"
    DISCARD_PILE = "discard_pile"
    PROCESSING = "processing"  # cards being used/resolved
    HAND = "hand"
    EQUIP = "equip"
    JUDGE = "judge"  # delayed tricks waiting in front of a player


OWNED_ZONES = frozenset({Zone.HAND, Zone.EQUIP, Zone.JUDGE})


class EquipSlot(StrEnum):
    WEAPON = "weapon"
    ARMOR = "armor"
    PLUS_HORSE = "plus_horse"  # others are 1 further from you
    MINUS_HORSE = "minus_horse"  # you are 1 closer to others


@dataclass(frozen=True, slots=True)
class Card:
    """A card. `name` is a content id like "strike" (never display text).

    Physical cards have id >= 0. Virtual cards (negative id) exist only while
    being used/played, e.g. two hand cards used *as* a Strike; the physical
    cards that actually move are tracked separately as `subcards`.
    """

    id: int
    name: str
    suit: Suit
    rank: int  # 1 (A) .. 13 (K); 0 for virtual cards with mixed ranks
    virtual_color: str | None = None  # "red" | "black" | "none" for virtual cards
    # Damage it deals: "fire" / "thunder" Strikes are still Strikes everywhere a Strike counts.
    nature: str = "normal"

    @property
    def is_virtual(self) -> bool:
        return self.id < 0

    @property
    def is_red(self) -> bool:
        if self.virtual_color is not None:
            return self.virtual_color == "red"
        return self.suit.is_red

    @property
    def is_black(self) -> bool:
        if self.virtual_color is not None:
            return self.virtual_color == "black"
        return self.suit.is_black

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"id": self.id, "name": self.name, "suit": str(self.suit), "rank": self.rank}
        if self.nature != "normal":
            d["nature"] = self.nature
        if self.is_virtual:
            d["virtual"] = True
            d["color"] = self.virtual_color
        return d


class CardDef:
    """Rules for one card name. Content packages subclass this."""

    name: str = ""
    type: CardType = CardType.BASIC
    target_count: int = 0  # how many targets the user picks (0 = none / implicit)
    min_targets: int | None = None  # fewer allowed (None = exactly target_count)
    # Played with no targets in your play phase, it's recast instead: discard it, draw 1.
    recastable: bool = False

    def can_use(self, game: Game, user: Player) -> bool:
        """Can `user` actively use this card during their play phase?"""
        return False

    def candidates(self, game: Game, user: Player) -> list[int]:
        """Seats that may be chosen as targets."""
        return []

    def auto_targets(self, game: Game, user: Player) -> list[int]:
        """Targets for cards that don't let the user choose (target_count == 0)."""
        return []

    def on_use(self, game: Game, use: CardUse) -> Gen:
        yield from ()


@dataclass
class CardUse:
    card: Card
    source: int
    targets: list[int]
    subcards: list[int] = field(default_factory=list)  # physical cards that were spent
    damage_bonus: int = 0
    cancelled: set[int] = field(default_factory=set)  # targets the effect no longer applies to
    data: dict[str, Any] = field(default_factory=dict)  # scratch space for card effects


@dataclass
class Judgment:
    seat: int
    reason: str  # card name / skill that asked for the judgment
    card: Card
    hit: bool = False
    hits: Callable[[Card], bool] | None = None  # the rule; lets skills preview an outcome


@dataclass
class Damage:
    source: int | None
    target: int
    amount: int
    card: Card | None = None
    nature: str = "normal"  # "normal" | "fire" | "thunder"
    prevented: bool = False
    chained: bool = False  # passed on along an Iron Chain (it doesn't pass on again)


@dataclass
class GameResult:
    side: str  # "lord" | "rebel" | "spy" | "draw"
    winners: list[int]


class GameOver(Exception):
    def __init__(self, result: GameResult):
        super().__init__(result.side)
        self.result = result
