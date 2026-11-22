"""The game state machine.

Design rules:
- No I/O here. Anything that may need a player decision is a generator; it
  `yield`s a Request and receives the answer. Compose with `yield from`.
- All randomness goes through `self.rng` (seeded) so seed + answers = replay.
- All card movement goes through `move_cards` (or `_raw_move` for internal
  bookkeeping), so the location map stays consistent and skills can react.
"""
from __future__ import annotations

import random
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from .equipment import EquipDef
from .events import ActiveSkill, Event, Skill, SkillBase, ViewAs
from .model import (
    OWNED_ZONES,
    Card,
    CardDef,
    CardUse,
    Damage,
    EquipSlot,
    GameOver,
    GameResult,
    Gen,
    Judgment,
    Phase,
    Role,
    Suit,
    Zone,
)
from .requests import (
    HAND,
    ChooseCardRequest,
    ChooseHeroRequest,
    Convert,
    ConvertOption,
    DiscardRequest,
    PlayOption,
    PlayRequest,
    Request,
    RespondRequest,
    SkillOption,
)
from .ruleset import Ruleset

L, Y, R, S = Role.LORD, Role.LOYALIST, Role.REBEL, Role.SPY
ROLE_TABLE: dict[int, tuple[Role, ...]] = {
    4: (L, Y, R, S),
    5: (L, Y, R, R, S),
    6: (L, Y, R, R, R, S),
    7: (L, Y, Y, R, R, R, S),
    8: (L, Y, Y, R, R, R, R, S),
}

STARTING_HAND = 4
DRAW_PER_TURN = 2
REBEL_KILL_REWARD = 3


@dataclass(eq=False)
class Player:
    seat: int
    role: Role
    hero: str = "blank"
    kingdom: str = ""
    gender: str = "male"  # set by the hero; matters for e.g. twin swords
    max_hp: int = 4
    hp: int = 4
    alive: bool = True
    hand: list[Card] = field(default_factory=list)
    equips: list[Card] = field(default_factory=list)
    judge: list[Card] = field(default_factory=list)
    skills: list[SkillBase] = field(default_factory=list)  # hero skills (equipment adds more)
    strikes_used: int = 0
    skip_phases: set[Phase] = field(default_factory=set)
    turn_usage: dict[str, int] = field(default_factory=dict)  # reset at the start of every turn
    marks: dict[str, Any] = field(default_factory=dict)  # whole-game state: limited used, awakened...

    @property
    def is_wounded(self) -> bool:
        return self.hp < self.max_hp

    def all_cards(self) -> list[Card]:
        return [*self.hand, *self.equips, *self.judge]


@dataclass
class DrawCount:
    seat: int
    count: int


@dataclass
class CardsMoved:
    card_ids: list[int]
    to: Zone
    owner: int | None
    reason: str


class Game:
    def __init__(
        self,
        ruleset: Ruleset,
        num_players: int,
        seed: int,
        roles: list[Role] | None = None,
        heroes: list[str | None] | None = None,
        draft: bool = False,
    ):
        """`heroes` assigns fixed heroes by seat (None = blank); `draft=True` lets players pick
        heroes at the start of run(). With neither, everyone is a skill-less 4 HP "blank" hero."""
        if num_players not in ROLE_TABLE:
            raise ValueError(f"unsupported player count: {num_players}")
        self.ruleset = ruleset
        self.seed = seed
        self.rng = random.Random(seed)

        deck = ruleset.build_deck()
        self.cards: dict[int, Card] = {c.id: c for c in deck}
        self.draw_pile: list[Card] = list(deck)  # top of pile = end of list
        self.rng.shuffle(self.draw_pile)
        self.discard_pile: list[Card] = []
        self.processing: list[Card] = []
        self.location: dict[int, tuple[Zone, int | None]] = {
            c.id: (Zone.DRAW_PILE, None) for c in self.draw_pile
        }

        if roles is None:
            roles = list(ROLE_TABLE[num_players])
            self.rng.shuffle(roles)
        if len(roles) != num_players or roles.count(Role.LORD) != 1:
            raise ValueError("roles must have one lord and match the player count")
        self.players = [Player(seat=i, role=r) for i, r in enumerate(roles)]
        self.lord_seat = roles.index(Role.LORD)

        self.current = self.lord_seat  # the lord takes the first turn
        self.phase: Phase | None = None
        self.turn_number = 0
        self.turn_over = False
        self.result: GameResult | None = None
        self.log: list[dict[str, Any]] = []
        self._virtual_seq = 0
        self._virtual_subcards: dict[int, list[int]] = {}
        self.draft = draft

        if heroes is not None:
            if len(heroes) != num_players:
                raise ValueError("need one hero per seat")
            for seat, hero_id in enumerate(heroes):
                if hero_id is not None:
                    self.assign_hero(seat, hero_id)
            if heroes[self.lord_seat] is None:
                self._apply_lord_bonus()
        elif not draft:
            self._apply_lord_bonus()

    # ------------------------------------------------------------------ heroes

    def _apply_lord_bonus(self) -> None:
        if len(self.players) >= 5:
            lord = self.players[self.lord_seat]
            lord.max_hp += 1
            lord.hp = lord.max_hp

    def assign_hero(self, seat: int, hero_id: str) -> None:
        hero = self.ruleset.heroes[hero_id]
        p = self.players[seat]
        p.hero, p.kingdom, p.gender = hero.id, str(hero.kingdom), hero.gender
        p.max_hp = p.hp = hero.max_hp
        p.skills = list(hero.skills)
        if seat == self.lord_seat:
            self._apply_lord_bonus()

    def choose_heroes(self, options_each: int = 3) -> Gen:
        """The Lord picks first (from every lord hero plus 2 others) and is revealed; then
        everyone else picks from `options_each` random heroes nobody has taken."""
        pool = sorted(self.ruleset.heroes)
        lords = [h for h in pool if self.ruleset.heroes[h].has_lord_skill]
        others = [h for h in pool if h not in lords]
        self.rng.shuffle(others)
        lord_opts = lords + others[:2]
        pick = yield from self.ask(ChooseHeroRequest(seat=self.lord_seat, options=lord_opts))
        self.assign_hero(self.lord_seat, pick)
        self._log("hero_chosen", seat=self.lord_seat, hero=pick)
        taken = {pick}
        for seat in self.seats_from(self.lord_seat)[1:]:
            free = [h for h in pool if h not in taken]
            opts = self.rng.sample(free, min(options_each, len(free)))
            pick = yield from self.ask(ChooseHeroRequest(seat=seat, options=opts))
            self.assign_hero(seat, pick)
            taken.add(pick)
        self._log("heroes_revealed", heroes=[p.hero for p in self.players])

    def skills_of(self, p: Player) -> list[SkillBase]:
        """Working skills: hero skills (lord skills only for the Lord) + equipment skills."""
        own = [s for s in p.skills if not s.lord or p.role == Role.LORD]
        for _, d in self.equip_defs(p):
            own += [s for s in (d.skill, d.view_as) if s is not None]
        return own

    def has_skill(self, p: Player, name: str) -> bool:
        return any(s.name == name for s in self.skills_of(p))

    def add_skill(self, p: Player, skill: SkillBase) -> None:
        p.skills.append(skill)
        self._log("skill_gained", seat=p.seat, skill=skill.name)

    def skill_ready(self, p: Player, s: SkillBase) -> bool:
        """Per-turn / once-per-game limits."""
        if s.limited and p.marks.get(s.name):
            return False
        return s.per_turn is None or p.turn_usage.get(s.name, 0) < s.per_turn

    def note_skill_used(self, p: Player, s: SkillBase) -> None:
        p.turn_usage[s.name] = p.turn_usage.get(s.name, 0) + 1
        if s.limited or s.awakening:
            p.marks[s.name] = True

    def change_max_hp(self, seat: int, delta: int) -> Gen:
        p = self.players[seat]
        p.max_hp += delta
        p.hp = min(p.hp, p.max_hp)
        self._log("max_hp", seat=seat, delta=delta, max_hp=p.max_hp, hp=p.hp)
        if p.max_hp <= 0:
            yield from self.die(seat, None)

    # ------------------------------------------------------------------ queries

    def card_def(self, card: Card) -> CardDef:
        return self.ruleset.card_defs[card.name]

    def alive_players(self) -> list[Player]:
        return [p for p in self.players if p.alive]

    def seats_from(self, start: int) -> list[int]:
        n = len(self.players)
        return [(start + i) % n for i in range(n)]

    def next_alive(self, seat: int) -> int:
        for s in self.seats_from(seat)[1:]:
            if self.players[s].alive:
                return s
        return seat

    # equipment

    def equip_defs(self, p: Player) -> list[tuple[Card, EquipDef]]:
        return [(c, self.card_def(c)) for c in p.equips]  # type: ignore[misc]

    def equip_in(self, p: Player, slot: EquipSlot) -> Card | None:
        return next((c for c, d in self.equip_defs(p) if d.slot == slot), None)

    def weapon_def(self, p: Player) -> EquipDef | None:
        w = self.equip_in(p, EquipSlot.WEAPON)
        return self.card_def(w) if w is not None else None  # type: ignore[return-value]

    def armor_active(self, seat: int, use: CardUse | None = None) -> bool:
        """Does `seat`'s armor work against `use` (None = not caused by a card use)?"""
        if self.equip_in(self.players[seat], EquipSlot.ARMOR) is None:
            return False
        if use is not None and use.card.name == "strike":
            w = self.weapon_def(self.players[use.source])
            if w is not None and w.ignores_armor:
                return False
        return True

    def conversions(self, p: Player) -> list[ViewAs]:
        return [
            s for s in self.skills_of(p)
            if isinstance(s, ViewAs) and s.enabled(self, p) and self.skill_ready(p, s)
        ]

    # distance / range / limits (equipment + skill modifiers)

    def distance(self, a: int, b: int) -> int:
        """Seats between two living players the short way round, adjusted by horses and
        skills (min 1)."""
        if a == b:
            return 0
        alive = [p.seat for p in self.players if p.alive]
        d = abs(alive.index(a) - alive.index(b))
        d = min(d, len(alive) - d)
        pa, pb = self.players[a], self.players[b]
        d += sum(e.distance_in for _, e in self.equip_defs(pb))
        d += sum(e.distance_out for _, e in self.equip_defs(pa))
        d += sum(s.distance_in(self, pb) for s in self.skills_of(pb))
        d += sum(s.distance_out(self, pa) for s in self.skills_of(pa))
        return max(d, 1)

    def in_attack_range(self, a: int, b: int) -> bool:
        return a != b and self.distance(a, b) <= self.attack_range(self.players[a])

    def attack_range(self, p: Player) -> int:
        w = self.weapon_def(p)
        base = w.attack_range if w is not None and w.attack_range is not None else 1
        return base + sum(s.attack_range_bonus(self, p) for s in self.skills_of(p))

    def strike_limit(self, p: Player) -> int:
        if any(d.unlimited_strikes for _, d in self.equip_defs(p)):
            return sys.maxsize
        return 1 + sum(s.extra_strikes(self, p) for s in self.skills_of(p))

    def trick_reach(self, p: Player) -> int:
        return 1  # distance limit for snatch-like tricks

    def has_in_judge(self, p: Player, name: str) -> bool:
        return any(c.name == name for c in p.judge)

    def hand_limit(self, p: Player) -> int:
        return max(p.hp, 0) + sum(s.hand_limit_bonus(self, p) for s in self.skills_of(p))

    def targetable(self, user: Player, seat: int, card_name: str) -> bool:
        t = self.players[seat]
        return all(s.can_be_targeted(self, t, card_name, user) for s in self.skills_of(t))

    def extra_targets(self, p: Player, card_name: str, whole_hand: bool) -> int:
        return sum(d.extra_targets(self, p, card_name, whole_hand) for _, d in self.equip_defs(p))

    def _target_spec(self, p: Player, d: CardDef, whole_hand: bool) -> tuple[int, int | None, tuple[int, ...]] | None:
        """(max targets, min targets or None, candidates) for using `d`, or None if impossible."""
        if not d.can_use(self, p):
            return None
        if not d.target_count:
            return 0, None, ()
        cands = tuple(s for s in d.candidates(self, p) if self.targetable(p, s, d.name))
        if len(cands) < d.target_count:
            return None
        extra = self.extra_targets(p, d.name, whole_hand)
        if extra:
            return min(d.target_count + extra, len(cands)), d.target_count, cands
        return d.target_count, None, cands

    def play_options(self, p: Player) -> dict[int, PlayOption]:
        opts: dict[int, PlayOption] = {}
        for c in p.hand:
            spec = self._target_spec(p, self.card_def(c), whole_hand=len(p.hand) == 1)
            if spec is not None:
                opts[c.id] = PlayOption(c.id, spec[0], spec[2], min_targets=spec[1])
        return opts

    def play_conversions(self, p: Player) -> list[ConvertOption]:
        out = []
        hand_ids = {c.id for c in p.hand}
        for v in self.conversions(p):
            cards = v.cards(self, p)
            if not v.in_play or len(cards) < v.count:
                continue
            whole_hand = v.count == len(hand_ids) and set(cards) == hand_ids
            spec = self._target_spec(p, self.ruleset.card_defs[v.as_name], whole_hand)
            if spec is not None:
                out.append(ConvertOption(v.name, v.as_name, v.count, tuple(cards), spec[0], spec[2], spec[1]))
        return out

    def response_conversions(self, p: Player, card_name: str) -> list[ConvertOption]:
        out = []
        for v in self.conversions(p):
            cards = v.cards(self, p)
            if v.in_response and v.as_name == card_name and len(cards) >= v.count:
                out.append(ConvertOption(v.name, v.as_name, v.count, tuple(cards)))
        return out

    def active_options(self, p: Player) -> list[SkillOption]:
        out = []
        for s in self.skills_of(p):
            if not isinstance(s, ActiveSkill) or not self.skill_ready(p, s) or not s.can_activate(self, p):
                continue
            cards = tuple(s.card_options(self, p)) if s.max_cards else ()
            cands = tuple(s.target_options(self, p)) if s.max_targets else ()
            if len(cards) < s.min_cards or len(cands) < s.min_targets:
                continue
            out.append(
                SkillOption(s.name, s.min_cards, s.max_cards, cards, s.min_targets, min(s.max_targets, len(cands)), cands)
            )
        return out

    def find_skill(self, p: Player, name: str) -> SkillBase | None:
        return next((s for s in self.skills_of(p) if s.name == name), None)

    def check_skill_use(self, p: Player, name: str, cards: list[int], targets: list[int]) -> str | None:
        """Skill-specific rules beyond what the request itself validates (bots use this too)."""
        s = self.find_skill(p, name)
        if isinstance(s, ViewAs):
            return s.check(self, p, cards)
        if isinstance(s, ActiveSkill):
            return s.check(self, p, cards, targets)
        return None

    def physical_cards(self, card: Card | None) -> list[int]:
        """The physical card ids behind `card` (itself, or a virtual card's subcards)."""
        if card is None:
            return []
        return list(self._virtual_subcards.get(card.id, [])) if card.is_virtual else [card.id]

    def make_virtual(self, name: str, subcard_ids: list[int]) -> Card:
        """A virtual card named `name` built from the given physical cards."""
        subs = [self.cards[i] for i in subcard_ids]
        suits = {c.suit for c in subs}
        colors = {"red" if c.is_red else "black" for c in subs}
        ranks = {c.rank for c in subs}
        self._virtual_seq -= 1
        self._virtual_subcards[self._virtual_seq] = list(subcard_ids)
        return Card(
            id=self._virtual_seq,
            name=name,
            suit=suits.pop() if len(suits) == 1 else Suit.NONE,
            rank=ranks.pop() if len(ranks) == 1 else 0,
            virtual_color=colors.pop() if len(colors) == 1 else "none",
        )

    # ------------------------------------------------------------------ log

    def _log(
        self, type_: str, private: tuple[Iterable[int], dict[str, Any]] | None = None, **data: Any
    ) -> None:
        """Public event; `private=(seats, extra)` adds details only those seats may see."""
        entry: dict[str, Any] = {"type": type_, **data}
        if private is not None:
            entry["private"] = {"seats": sorted(set(private[0])), "data": private[1]}
        self.log.append(entry)

    # ------------------------------------------------------------------ zones

    def _zone_list(self, zone: Zone, owner: int | None) -> list[Card]:
        match zone:
            case Zone.DRAW_PILE:
                return self.draw_pile
            case Zone.DISCARD_PILE:
                return self.discard_pile
            case Zone.PROCESSING:
                return self.processing
            case Zone.HAND:
                return self.players[owner].hand  # type: ignore[index]
            case Zone.EQUIP:
                return self.players[owner].equips  # type: ignore[index]
            case Zone.JUDGE:
                return self.players[owner].judge  # type: ignore[index]
        raise ValueError(zone)

    def _raw_move(self, card_id: int, to: Zone, owner: int | None = None) -> None:
        if to in OWNED_ZONES and owner is None:
            raise ValueError(f"{to} needs an owner")
        card = self.cards[card_id]
        frm, frm_owner = self.location[card_id]
        self._zone_list(frm, frm_owner).remove(card)
        self._zone_list(to, owner).append(card)
        self.location[card_id] = (to, owner if to in OWNED_ZONES else None)

    def move_cards(self, card_ids: Iterable[int], to: Zone, owner: int | None = None, reason: str = "") -> Gen:
        ids = list(card_ids)
        if not ids:
            return
        for cid in ids:
            self._raw_move(cid, to, owner)
        yield from self.trigger(Event.CARDS_MOVED, CardsMoved(ids, to, owner, reason))

    def _take_from_pile(self, n: int) -> list[int]:
        if len(self.draw_pile) < n:
            remaining = list(self.draw_pile)
            refill = list(self.discard_pile)
            self.rng.shuffle(refill)
            for c in refill:
                self._raw_move(c.id, Zone.DRAW_PILE)
            self.draw_pile[:] = refill + remaining  # old cards stay on top
            self._log("reshuffle", draw_pile=len(self.draw_pile))
        if len(self.draw_pile) < n:
            raise GameOver(GameResult("draw", []))
        return [self.draw_pile[-1 - i].id for i in range(n)]

    def draw(self, seat: int, n: int, reason: str = "draw") -> Gen:
        ids = self._take_from_pile(n)
        self._log(
            "draw",
            seat=seat,
            count=n,
            reason=reason,
            private=([seat], {"cards": [self.cards[i].to_dict() for i in ids]}),
        )
        yield from self.move_cards(ids, Zone.HAND, seat, reason)

    def discard(self, seat: int, card_ids: list[int], reason: str = "discard") -> Gen:
        self._log("discard", seat=seat, cards=[self.cards[i].to_dict() for i in card_ids], reason=reason)
        yield from self.move_cards(card_ids, Zone.DISCARD_PILE, reason=reason)

    def _flush_processing(self, *cards: Card) -> Gen:
        ids = [c.id for c in cards if self.location[c.id][0] == Zone.PROCESSING]
        yield from self.move_cards(ids, Zone.DISCARD_PILE, reason="settle")

    # ------------------------------------------------------------------ plumbing

    def ask(self, req: Request, check: Callable[[Any], str | None] | None = None) -> Gen:
        """Yield `req` until a valid answer comes back. `check` adds game-aware validation
        on top of the request's own."""
        while True:
            answer = yield req
            err = req.validate(answer)
            if err is None and check is not None:
                err = check(answer)
            if err is None:
                req.error = None
                return answer
            req.error = err

    def trigger(self, event: Event, data: Any = None) -> Gen:
        """Fire `event` for every living player's skills (hero skills, then equipment),
        in seat order from the current player."""
        for seat in self.seats_from(self.current):
            p = self.players[seat]
            if not p.alive:
                continue
            for skill in self.skills_of(p):
                if not isinstance(skill, Skill) or event not in skill.events:
                    continue
                if skill.awakening and p.marks.get(skill.name):
                    continue
                if not p.alive or not skill.can_trigger(self, p, event, data):
                    continue
                if skill.awakening or skill.locked:
                    self._log("skill", seat=seat, skill=skill.name)
                if skill.awakening:
                    self.note_skill_used(p, skill)
                yield from skill.on_trigger(self, p, event, data)

    # ------------------------------------------------------------------ actions

    def use_card(
        self,
        seat: int,
        card: int | Card,
        targets: list[int],
        subcards: list[int] | None = None,
        data: dict[str, Any] | None = None,
    ) -> Gen:
        """Use a card (a physical card id, or a virtual Card plus the `subcards` spent on it)."""
        if isinstance(card, int):
            card = self.cards[card]
        if subcards is None:
            subcards = [] if card.is_virtual else [card.id]
        d = self.card_def(card)
        if d.target_count == 0:
            targets = d.auto_targets(self, self.players[seat])
        use = CardUse(card=card, source=seat, targets=list(targets), subcards=list(subcards), data=dict(data or {}))
        usage = self.players[seat].turn_usage
        usage["_cards_used"] = usage.get("_cards_used", 0) + 1
        extra = {"subcards": [self.cards[i].to_dict() for i in subcards]} if card.is_virtual else {}
        self._log("use", seat=seat, card=card.to_dict(), targets=list(targets), **extra)
        yield from self.move_cards(subcards, Zone.PROCESSING, reason="use")
        yield from self.trigger(Event.CARD_USED, use)
        yield from d.on_use(self, use)
        yield from self._flush_processing(*(self.cards[i] for i in subcards))
        yield from self.trigger(Event.CARD_FINISHED, use)
        return use

    def use_strike(self, seat: int, target: int, reason: str, context: dict[str, Any] | None = None) -> Gen:
        """Ask `seat` to use a Strike on `target` outside their play phase (doesn't count
        towards the per-turn limit). Returns the CardUse, or None if they decline."""
        picked = yield from self._ask_card(seat, "strike", reason, about=target, context=context)
        if picked is None:
            return None
        card, subs = picked
        return (yield from self.use_card(seat, card, [target], subcards=subs, data={"free": True}))

    def nullified(self, card: Card, source: int | None, target: int) -> Gen:
        """Nullify window for `card`'s effect on `target`. Returns True if cancelled.

        Everyone (in seat order from the current player) may nullify; a nullify
        can itself be nullified, so each one played flips the outcome and opens
        a fresh window.
        """
        cancelled = False
        chain = 0
        while True:
            context = {
                "card": card.to_dict(),
                "source": source,
                "target": target,
                "cancelled": cancelled,
                "chain": chain,
            }
            played_by = None
            for seat in self.seats_from(self.current):
                c = yield from self.respond(seat, "nullify", reason="nullify", about=target, context=context)
                if c is not None:
                    played_by = seat
                    break
            if played_by is None:
                return cancelled
            cancelled = not cancelled
            chain += 1
            self._log("nullify", seat=played_by, card=card.to_dict(), target=target, cancelled=cancelled)

    def judge(self, seat: int, reason: str, hits: Callable[[Card], bool]) -> Gen:
        """Flip the top card of the deck; skills may replace it before the result."""
        (cid,) = self._take_from_pile(1)
        j = Judgment(seat=seat, reason=reason, card=self.cards[cid], hits=hits)
        yield from self.move_cards([cid], Zone.PROCESSING, reason="judge")
        self._log("judge", seat=seat, reason=reason, card=j.card.to_dict())
        yield from self.trigger(Event.JUDGE_CARD, j)
        j.hit = hits(j.card)
        self._log("judge_result", seat=seat, reason=reason, card=j.card.to_dict(), hit=j.hit)
        yield from self.trigger(Event.JUDGE_RESULT, j)
        yield from self._flush_processing(j.card)
        return j

    def choose_card_from(
        self,
        chooser: int,
        target: int,
        reason: str,
        include_judge: bool = True,
        optional: bool = False,
    ) -> Gen:
        """`chooser` picks one of `target`'s cards (hand cards face down). Returns card id or None."""
        t = self.players[target]
        visible = [c.id for c in [*t.equips, *(t.judge if include_judge else [])]]
        if not visible and not t.hand:
            return None
        ans = yield from self.ask(
            ChooseCardRequest(
                seat=chooser,
                reason=reason,
                about=target,
                options=visible,
                hidden_count=len(t.hand),
                optional=optional,
            )
        )
        if ans == HAND:
            return self.rng.choice(t.hand).id
        return ans

    def _ask_card(
        self,
        seat: int,
        card_name: str,
        reason: str,
        about: int | None = None,
        context: dict[str, Any] | None = None,
    ) -> Gen:
        """Ask `seat` for a `card_name` (real or converted) without moving anything.

        Returns (Card, subcard ids) or None. Players with no possible card are
        skipped without asking. (The server can add a short fake delay so this
        doesn't leak hand information.)
        """
        p = self.players[seat]
        if not p.alive:
            return None
        options = [c.id for c in p.hand if c.name == card_name]
        convs = self.response_conversions(p, card_name)
        if not options and not convs:
            return None
        answer = yield from self.ask(
            RespondRequest(
                seat=seat,
                card_name=card_name,
                reason=reason,
                about=about,
                options=options,
                conversions=convs,
                context=context or {},
            ),
            check=lambda a: self.check_skill_use(p, a.skill, list(a.cards), []) if isinstance(a, Convert) else None,
        )
        if answer is None:
            return None
        if isinstance(answer, Convert):
            subs = list(answer.cards)
            self.note_skill_used(p, self.find_skill(p, answer.skill))  # type: ignore[arg-type]
            return self.make_virtual(card_name, subs), subs
        return self.cards[answer], [answer]

    def respond(
        self,
        seat: int,
        card_name: str,
        reason: str,
        about: int | None = None,
        context: dict[str, Any] | None = None,
        use: CardUse | None = None,
    ) -> Gen:
        """Ask `seat` to play a `card_name` (e.g. Dodge against `use`). Returns the Card or None.

        Equipment that can stand in for the card (armor providing a Dodge) is
        offered first; then a real or converted card is asked for.
        """
        p = self.players[seat]
        if not p.alive:
            return None
        helpers: list[Any] = [
            eq for _, eq in self.equip_defs(p)
            if card_name in eq.assists and (eq.slot != EquipSlot.ARMOR or self.armor_active(seat, use))
        ]
        helpers += [s for s in self.skills_of(p) if card_name in s.assists]
        for h in helpers:
            got = yield from h.assist(self, p, card_name, reason, about)
            if got is not None:
                self._log("respond", seat=seat, card=got.to_dict(), reason=reason, via=h.name)
                yield from self.trigger(Event.CARD_RESPONDED, (seat, got))
                return got
        picked = yield from self._ask_card(seat, card_name, reason, about, context)
        if picked is None:
            return None
        card, subs = picked
        extra = {"subcards": [self.cards[i].to_dict() for i in subs]} if card.is_virtual else {}
        self._log("respond", seat=seat, card=card.to_dict(), reason=reason, **extra)
        yield from self.move_cards(subs, Zone.PROCESSING, reason="respond")
        yield from self.trigger(Event.CARD_RESPONDED, (seat, card))
        yield from self._flush_processing(*(self.cards[i] for i in subs))
        return card

    def damage(
        self,
        source: int | None,
        target: int,
        amount: int,
        card: Card | None = None,
        nature: str = "normal",
    ) -> Gen:
        t = self.players[target]
        if not t.alive:
            return
        dmg = Damage(source=source, target=target, amount=amount, card=card, nature=nature)
        yield from self.trigger(Event.DAMAGE_CAUSED, dmg)
        if dmg.prevented or dmg.amount <= 0:
            return
        yield from self.trigger(Event.DAMAGE_INFLICTED, dmg)
        if dmg.prevented or dmg.amount <= 0:
            return
        t.hp -= dmg.amount
        t.turn_usage["_damage_taken"] = t.turn_usage.get("_damage_taken", 0) + dmg.amount
        self._log("damage", source=source, target=target, amount=dmg.amount, nature=nature, hp=t.hp)
        if t.hp <= 0:
            yield from self.dying(target, dmg)
        if t.alive:
            yield from self.trigger(Event.DAMAGED, dmg)

    def recover(self, seat: int, amount: int, source: int | None = None) -> Gen:
        p = self.players[seat]
        healed = min(amount, p.max_hp - p.hp)
        if not p.alive or healed <= 0:
            return
        p.hp += healed
        self._log("recover", seat=seat, amount=healed, hp=p.hp, source=source)
        yield from self.trigger(Event.RECOVERED, (seat, healed))

    def dying(self, seat: int, cause: Damage | None) -> Gen:
        p = self.players[seat]
        self._log("dying", seat=seat, hp=p.hp)
        yield from self.trigger(Event.DYING, seat)
        for helper in self.seats_from(self.current):
            if p.hp > 0:
                break
            if not self.players[helper].alive:
                continue
            while p.hp <= 0:
                peach = yield from self.respond(helper, "peach", reason="save", about=seat)
                if peach is None:
                    break
                yield from self.recover(seat, 1, source=helper)
        if p.hp <= 0:
            yield from self.die(seat, cause)

    def die(self, seat: int, cause: Damage | None) -> Gen:
        p = self.players[seat]
        p.alive = False
        killer = cause.source if cause else None
        self._log("death", seat=seat, role=str(p.role), killer=killer)
        yield from self.trigger(Event.DEATH, (seat, cause))
        leftovers = [c.id for c in p.all_cards()]
        if leftovers:
            yield from self.discard(seat, leftovers, reason="death")
        self.check_game_over()
        if seat == self.current:
            self.turn_over = True

        if killer is None or killer == seat or not self.players[killer].alive:
            return
        if p.role == Role.REBEL:
            yield from self.draw(killer, REBEL_KILL_REWARD, reason="kill_reward")
        elif p.role == Role.LOYALIST and killer == self.lord_seat:
            lord = self.players[killer]
            lost = [c.id for c in [*lord.hand, *lord.equips]]
            if lost:
                yield from self.discard(killer, lost, reason="kill_penalty")

    def check_game_over(self) -> None:
        alive = self.alive_players()
        if not self.players[self.lord_seat].alive:
            if len(alive) == 1 and alive[0].role == Role.SPY:
                raise GameOver(GameResult("spy", [alive[0].seat]))
            raise GameOver(GameResult("rebel", [p.seat for p in self.players if p.role == Role.REBEL]))
        if not any(p.role in (Role.REBEL, Role.SPY) for p in alive):
            raise GameOver(
                GameResult("lord", [p.seat for p in self.players if p.role in (Role.LORD, Role.LOYALIST)])
            )

    # ------------------------------------------------------------------ flow

    def run(self) -> Gen:
        """Play a whole game. Returns the GameResult (as the generator's return value)."""
        try:
            if self.draft:
                yield from self.choose_heroes()
            self._log(
                "game_start",
                players=len(self.players),
                lord=self.lord_seat,
                lord_hp=self.players[self.lord_seat].max_hp,
                heroes=[p.hero for p in self.players],
            )
            for seat in self.seats_from(self.lord_seat):
                yield from self.draw(seat, STARTING_HAND, reason="deal")
            while True:
                yield from self.take_turn(self.current)
                self.current = self.next_alive(self.current)
        except GameOver as over:
            self.result = over.result
            self.phase = None
            self._log(
                "game_over",
                side=over.result.side,
                winners=over.result.winners,
                roles=[str(p.role) for p in self.players],
            )
            return over.result

    def take_turn(self, seat: int) -> Gen:
        p = self.players[seat]
        self.current = seat
        self.turn_number += 1
        self.turn_over = False
        p.strikes_used = 0
        for q in self.players:
            q.turn_usage.clear()  # "once per turn" means per anyone's turn
        self._log("turn_start", seat=seat, turn=self.turn_number)
        yield from self.trigger(Event.TURN_START, p)
        for phase in Phase:
            if not p.alive or self.turn_over:
                break
            if phase in p.skip_phases:
                p.skip_phases.discard(phase)
                self._log("phase_skipped", seat=seat, phase=str(phase))
                continue
            self.phase = phase
            self._log("phase", seat=seat, phase=str(phase))
            yield from self.trigger(Event.PHASE_START, phase)
            yield from getattr(self, f"phase_{phase.value}")(p)
            yield from self.trigger(Event.PHASE_END, phase)
        self.phase = None
        if p.alive:
            yield from self.trigger(Event.TURN_END, p)

    def phase_start(self, p: Player) -> Gen:
        yield from ()

    def phase_judge(self, p: Player) -> Gen:
        """Resolve delayed tricks, last placed first. Each def implements `resolve_delayed`."""
        for card in list(reversed(p.judge)):
            if not p.alive or self.turn_over:
                return
            if card in p.judge:
                yield from self.card_def(card).resolve_delayed(self, p, card)  # type: ignore[attr-defined]

    def phase_draw(self, p: Player) -> Gen:
        data = DrawCount(p.seat, DRAW_PER_TURN)
        yield from self.trigger(Event.DRAW_PHASE, data)
        if data.count > 0:
            yield from self.draw(p.seat, data.count)

    def phase_play(self, p: Player) -> Gen:
        while p.alive and not self.turn_over:
            req = PlayRequest(
                seat=p.seat,
                options=self.play_options(p),
                conversions=self.play_conversions(p),
                skills=self.active_options(p),
            )
            answer = yield from self.ask(
                req,
                check=lambda a: (
                    self.check_skill_use(p, a.skill, list(a.cards), list(a.targets))
                    if a is not None and a.skill is not None
                    else None
                ),
            )
            if answer is None:
                return
            cards, targets = list(answer.cards), list(answer.targets)
            if answer.skill is None:
                yield from self.use_card(p.seat, answer.card_id, targets)  # type: ignore[arg-type]
                continue
            skill = self.find_skill(p, answer.skill)
            self.note_skill_used(p, skill)  # type: ignore[arg-type]
            conv = req.conversion(answer.skill)
            if conv is not None:
                card = self.make_virtual(conv.as_name, cards)
                yield from self.use_card(p.seat, card, targets, subcards=cards, data={"skill": answer.skill})
            else:
                self._log(
                    "skill", seat=p.seat, skill=answer.skill, targets=targets,
                    cards=len(cards),
                )
                yield from skill.activate(self, p, cards, targets)  # type: ignore[union-attr]

    def phase_discard(self, p: Player) -> Gen:
        excess = len(p.hand) - self.hand_limit(p)
        if excess <= 0:
            return
        ids = yield from self.ask(DiscardRequest(seat=p.seat, count=excess, options=[c.id for c in p.hand]))
        yield from self.discard(p.seat, list(ids), reason="discard_phase")

    def phase_end(self, p: Player) -> Gen:
        yield from ()
