"""Questions the engine asks players, and the answers it accepts.

The engine yields a Request; whoever drives the game (tests, bots, the network
server) sends back an answer. Invalid answers are re-asked with `error` set.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar


@dataclass(frozen=True)
class Play:
    """Answer to PlayRequest: use `card_id` on `targets`. Answer None to end the play phase.

    To use a conversion instead, leave `card_id` None and set `skill` (a
    ConvertOption.skill) plus the physical `cards` to spend.
    """

    card_id: int | None = None
    targets: tuple[int, ...] = ()
    skill: str | None = None
    cards: tuple[int, ...] = ()


@dataclass(frozen=True)
class Convert:
    """Answer to RespondRequest: play `cards` through the conversion `skill`."""

    skill: str
    cards: tuple[int, ...]


@dataclass(frozen=True)
class ConvertOption:
    """A conversion the player may use now: spend `count` of `cards` as `as_name`."""

    skill: str
    as_name: str
    count: int
    cards: tuple[int, ...]
    target_count: int = 0  # max targets (play phase only)
    candidates: tuple[int, ...] = ()
    min_targets: int | None = None  # None = exactly target_count

    def check_cards(self, cards: tuple[int, ...]) -> str | None:
        cards = tuple(cards)
        if len(cards) != self.count or len(set(cards)) != len(cards) or any(c not in self.cards for c in cards):
            return f"choose exactly {self.count} card(s) for {self.skill}"
        return None


@dataclass(frozen=True)
class SkillOption:
    """An active skill usable now: spend min..max of `cards`, pick min..max of `candidates`."""

    skill: str
    min_cards: int
    max_cards: int
    cards: tuple[int, ...]
    min_targets: int
    target_count: int  # max targets
    candidates: tuple[int, ...]

    def check_cards(self, cards: tuple[int, ...]) -> str | None:
        cards = tuple(cards)
        if not self.min_cards <= len(cards) <= self.max_cards:
            if self.min_cards == self.max_cards:
                return f"choose exactly {self.min_cards} card(s) for {self.skill}"
            return f"choose {self.min_cards}-{self.max_cards} cards for {self.skill}"
        if len(set(cards)) != len(cards) or any(c not in self.cards for c in cards):
            return "invalid cards"
        return None


def _check_targets(opt: Any, targets: tuple[int, ...]) -> str | None:
    lo = opt.target_count if opt.min_targets is None else opt.min_targets
    if not lo <= len(targets) <= opt.target_count:
        if lo == opt.target_count:
            return f"choose exactly {opt.target_count} target(s)"
        return f"choose {lo}-{opt.target_count} targets"
    if len(set(targets)) != len(targets):
        return "duplicate targets"
    if any(t not in opt.candidates for t in targets):
        return "invalid target"
    return None


@dataclass(kw_only=True)
class Request:
    kind: ClassVar[str] = "request"
    seat: int
    error: str | None = None

    def validate(self, answer: Any) -> str | None:
        return None

    def default(self) -> Any:
        """Answer used when the player times out."""
        return None


@dataclass(frozen=True)
class PlayOption:
    card_id: int
    target_count: int  # max targets
    candidates: tuple[int, ...]
    min_targets: int | None = None  # None = exactly target_count


@dataclass(kw_only=True)
class PlayRequest(Request):
    kind: ClassVar[str] = "play"
    options: dict[int, PlayOption]
    conversions: list[ConvertOption] = field(default_factory=list)
    skills: list[SkillOption] = field(default_factory=list)

    def conversion(self, skill: str | None) -> ConvertOption | None:
        return next((c for c in self.conversions if c.skill == skill), None)

    def active(self, skill: str | None) -> SkillOption | None:
        return next((s for s in self.skills if s.skill == skill), None)

    def validate(self, answer: Any) -> str | None:
        if answer is None:
            return None
        if not isinstance(answer, Play):
            return "expected a Play or None"
        opt: Any
        if answer.skill is not None:
            opt = self.conversion(answer.skill) or self.active(answer.skill)
            if opt is None:
                return "that skill cannot be used now"
            err = opt.check_cards(answer.cards)
            if err:
                return err
        else:
            opt = self.options.get(answer.card_id)  # type: ignore[arg-type]
            if opt is None:
                return "that card cannot be played now"
        return _check_targets(opt, tuple(answer.targets))


@dataclass(kw_only=True)
class RespondRequest(Request):
    """Play a card named `card_name` in response (dodge vs strike, peach to save...)."""

    kind: ClassVar[str] = "respond"
    card_name: str
    reason: str
    about: int | None = None  # attacker, or dying player being saved
    options: list[int]
    conversions: list[ConvertOption] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)  # e.g. what a nullify would cancel

    def validate(self, answer: Any) -> str | None:
        if answer is None or answer in self.options:
            return None
        if isinstance(answer, Convert):
            conv = next((c for c in self.conversions if c.skill == answer.skill), None)
            if conv is None:
                return "that skill cannot be used now"
            return conv.check_cards(answer.cards)
        return "you cannot respond with that card"


HAND = "hand"


class _Refresh:
    """Answer to a PlayRequest meaning "the table changed under you (test room): ask again"."""

    def __repr__(self) -> str:
        return "REFRESH"


REFRESH = _Refresh()


@dataclass(kw_only=True)
class ChooseCardRequest(Request):
    """Pick one card: a visible card id from `options`, or "hand" for a random
    face-down hand card when `hidden_count` > 0 (dismantle, snatch, harvest...)."""

    kind: ClassVar[str] = "choose_card"
    reason: str
    about: int | None = None  # whose cards these are (None = revealed cards)
    options: list[int]
    hidden_count: int = 0
    optional: bool = False  # may answer None to choose nothing
    # Faces of cards only the asked player may see (e.g. looked at from the top of the
    # deck): the request is the only place their client learns what they are.
    shown: list[dict[str, Any]] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)

    def validate(self, answer: Any) -> str | None:
        if answer in self.options or (answer == HAND and self.hidden_count > 0):
            return None
        if answer is None and self.optional:
            return None
        return "invalid choice"

    def default(self) -> Any:
        if self.optional:
            return None
        return HAND if self.hidden_count else self.options[0]


@dataclass(kw_only=True)
class ChooseHeroRequest(Request):
    kind: ClassVar[str] = "choose_hero"
    options: list[str]  # hero ids

    def validate(self, answer: Any) -> str | None:
        return None if answer in self.options else "pick one of the offered heroes"

    def default(self) -> Any:
        return self.options[0]


@dataclass(kw_only=True)
class ConfirmRequest(Request):
    """Yes/no: use an optional effect (e.g. an armor or weapon ability)?"""

    kind: ClassVar[str] = "confirm"
    reason: str
    about: int | None = None
    context: dict[str, Any] = field(default_factory=dict)

    def validate(self, answer: Any) -> str | None:
        return None if isinstance(answer, bool) else "expected true or false"

    def default(self) -> Any:
        return False


@dataclass(kw_only=True)
class ChoosePlayerRequest(Request):
    kind: ClassVar[str] = "choose_player"
    reason: str
    about: int | None = None
    options: list[int]
    optional: bool = False  # may answer None to choose nobody

    def validate(self, answer: Any) -> str | None:
        if answer is None and self.optional:
            return None
        return None if answer in self.options else "invalid player"

    def default(self) -> Any:
        return None if self.optional else self.options[0]


@dataclass(kw_only=True)
class ArrangeRequest(Request):
    """Look at `cards` (in order, first = top of the deck) and put each back on the top
    (in the order given) or, if `allow_bottom`, on the bottom. Answer: (top, bottom)."""

    kind: ClassVar[str] = "arrange"
    reason: str
    options: list[int]
    cards: list[dict[str, Any]] = field(default_factory=list)  # faces: only the asked player sees them
    allow_bottom: bool = True

    def validate(self, answer: Any) -> str | None:
        if not isinstance(answer, tuple) or len(answer) != 2:
            return "expected (top, bottom)"
        top, bottom = (list(x) for x in answer)
        if sorted(top + bottom) != sorted(self.options):
            return "place every card exactly once"
        if bottom and not self.allow_bottom:
            return "cards can only go back on top"
        return None

    def default(self) -> Any:
        return (tuple(self.options), ())


@dataclass(kw_only=True)
class ChooseOptionRequest(Request):
    """Pick one of several named choices (the first one is the timeout default)."""

    kind: ClassVar[str] = "choose_option"
    reason: str
    about: int | None = None
    choices: list[str]

    def validate(self, answer: Any) -> str | None:
        return None if answer in self.choices else "invalid choice"

    def default(self) -> Any:
        return self.choices[0]


@dataclass(kw_only=True)
class DiscardRequest(Request):
    kind: ClassVar[str] = "discard"
    count: int
    options: list[int]
    reason: str = "discard_phase"
    # Not always a discard: a skill may use it to have you pick hand cards for another use
    # (False Letter: which card to hand over). `about`/`context` let the client word it.
    about: int | None = None
    context: dict[str, Any] = field(default_factory=dict)

    def validate(self, answer: Any) -> str | None:
        if not isinstance(answer, (list, tuple)):
            return "expected a list of card ids"
        if len(answer) != self.count:
            return f"discard exactly {self.count} card(s)"
        if len(set(answer)) != len(answer) or any(a not in self.options for a in answer):
            return "invalid cards"
        return None

    def default(self) -> Any:
        return self.options[-self.count :]
