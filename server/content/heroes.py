"""Hero roster: the 25 heroes of the standard set (Wei 7, Shu 7, Wu 8, Qun 3), plus two
extras of our own (Wei Lie, Yu Ji) and six modern parody heroes designed at our table (Qun).

Each skill plays like its counterpart in the classic game, under our own name and rules
text (the docstring, sent to clients as-is; Chinese in content/i18n.py).
"""
from __future__ import annotations

from engine import (
    ActiveSkill,
    ArrangeRequest,
    CardType,
    ChooseCardRequest,
    ChooseOptionRequest,
    ChoosePlayerRequest,
    ConfirmRequest,
    DiscardRequest,
    EquipSlot,
    Event,
    Hero,
    Kingdom,
    Phase,
    Skill,
    Suit,
    ViewAs,
    Zone,
)
from engine.model import Gen

W, S, U, Q = Kingdom.WEI, Kingdom.SHU, Kingdom.WU, Kingdom.QUN
DELAYED = ("indulgence", "lightning")


# ---------------------------------------------------------------- helpers


def _my_phase(game, owner, event, data, phase: Phase) -> bool:
    return event == Event.PHASE_START and data == phase and game.current == owner.seat


def _others(game, owner) -> list[int]:
    return [s for s in game.seats_from(owner.seat)[1:] if game.players[s].alive]


def _owned(p) -> list[int]:
    """Hand and equipment card ids."""
    return [c.id for c in [*p.hand, *p.equips]]


def _announce(game, owner, skill) -> None:
    """Log an optional skill as it fires (locked ones are logged by the engine)."""
    game._log("skill", seat=owner.seat, skill=skill.name)


def _ask_yes(game, owner, skill, about=None, context=None) -> Gen:
    return (yield from game.ask(ConfirmRequest(seat=owner.seat, reason=skill.name, about=about, context=context or {})))


def _give(game, giver: int, receiver: int, card_id: int, reason: str) -> Gen:
    game._log(
        "give", seat=giver, target=receiver, reason=reason,
        private=([giver, receiver], {"card": game.cards[card_id].to_dict()}),
    )
    yield from game.move_cards([card_id], Zone.HAND, receiver, reason=reason)


def _take(game, taker: int, target: int, card_id: int, reason: str) -> Gen:
    zone = game.location[card_id][0]
    card = game.cards[card_id].to_dict()
    if zone == Zone.HAND:
        game._log("take", seat=taker, target=target, zone=str(zone), reason=reason,
                  private=([taker, target], {"card": card}))
    else:
        game._log("take", seat=taker, target=target, zone=str(zone), reason=reason, card=card)
    yield from game.move_cards([card_id], Zone.HAND, taker, reason=reason)


def _take_loose(game, taker: int, card_ids: list[int], reason: str) -> Gen:
    """Take face-up cards that belong to nobody (being resolved, or just discarded)."""
    game._log("take", seat=taker, target=None, zone=str(game.location[card_ids[0]][0]), reason=reason,
              cards=[game.cards[i].to_dict() for i in card_ids])
    yield from game.move_cards(card_ids, Zone.HAND, taker, reason=reason)


def _dealt_by(game, dmg) -> list[int]:
    """The physical card(s) that dealt `dmg`, if they're still being resolved."""
    return [i for i in game.physical_cards(dmg.card) if game.location[i][0] == Zone.PROCESSING]


def _strike_targets(game, owner) -> list[int]:
    strike = game.ruleset.card_defs["strike"]
    return [s for s in strike.candidates(game, owner) if game.targetable(owner, s, "strike")]


class _Conversion(ViewAs):
    """Use/play one card matching `fits` (hand, plus equipment if `equipment`) as `as_name`."""

    equipment = False

    def fits(self, card) -> bool:
        return True

    def cards(self, game, owner):
        pool = [*owner.hand, *(owner.equips if self.equipment else [])]
        return [c.id for c in pool if self.fits(c)]


class _AskAllies(Skill):
    """Lord helper: when the owner needs `card`, other `kingdom` characters may play one for them."""

    kingdom = W
    card = "dodge"

    def _allies(self, game, owner) -> list[int]:
        return [s for s in _others(game, owner) if game.players[s].kingdom == self.kingdom]

    def assist(self, game, owner, card_name, reason, about) -> Gen:
        helpers = self._allies(game, owner)
        if not helpers:
            return None
        if not (yield from _ask_yes(game, owner, self, about=about)):
            return None
        for h in helpers:
            card = yield from game.respond(h, card_name, reason=self.name, about=owner.seat)
            if card is not None:
                return game.make_virtual(card_name, [])
        return None


# ================================================================= WEI


class ProfitFromLoss(Skill):
    """After you take damage, you may take the card(s) that dealt it into your hand."""

    name = "profit_from_loss"
    events = (Event.DAMAGED,)

    def can_trigger(self, game, owner, event, dmg):
        return dmg.target == owner.seat and bool(_dealt_by(game, dmg))

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        if (yield from _ask_yes(game, owner, self, about=dmg.source)):
            _announce(game, owner, self)
            yield from _take_loose(game, owner.seat, _dealt_by(game, dmg), self.name)


class GuardTheThrone(_AskAllies):
    """Lord. When you need to play a Dodge, you may ask the other Wei characters, in seat
    order, to play one for you."""

    name = "guard_the_throne"
    lord = True
    assists = frozenset({"dodge"})


class TitForTat(Skill):
    """After you take damage from a player, you may take one of their cards (hand or
    equipment)."""

    name = "tit_for_tat"
    events = (Event.DAMAGED,)

    def can_trigger(self, game, owner, event, dmg):
        if dmg.target != owner.seat or dmg.source is None or dmg.source == owner.seat:
            return False
        src = game.players[dmg.source]
        return src.alive and bool(src.hand or src.equips)

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        if not (yield from _ask_yes(game, owner, self, about=dmg.source)):
            return
        _announce(game, owner, self)
        cid = yield from game.choose_card_from(owner.seat, dmg.source, reason=self.name, include_judge=False)
        if cid is not None:
            yield from _take(game, owner.seat, dmg.source, cid, self.name)


class BendFate(Skill):
    """Before any judgment's result is decided, you may play a hand card to replace the
    judgment card."""

    name = "bend_fate"
    events = (Event.JUDGE_CARD,)

    def can_trigger(self, game, owner, event, j):
        return bool(owner.hand)

    def on_trigger(self, game, owner, event, j) -> Gen:
        cid = yield from game.ask(
            ChooseCardRequest(
                seat=owner.seat, reason=self.name, about=owner.seat, options=[c.id for c in owner.hand],
                optional=True,
                context={
                    "judge_reason": j.reason, "seat": j.seat, "card": j.card.to_dict(),
                    "would_hit": bool(j.hits and j.hits(j.card)),
                },
            )
        )
        if cid is None:
            return
        old = j.card
        game._log("rejudge", seat=owner.seat, old=old.to_dict(), card=game.cards[cid].to_dict(), via=self.name)
        yield from game.move_cards([cid], Zone.PROCESSING, reason=self.name)
        yield from game.move_cards([old.id], Zone.DISCARD_PILE, reason=self.name)
        j.card = game.cards[cid]


class BloodForBlood(Skill):
    """After you take damage from a player, you may judge: unless it's a Heart ♥, they must
    discard 2 hand cards or take 1 damage from you (their choice)."""

    name = "blood_for_blood"
    events = (Event.DAMAGED,)

    def can_trigger(self, game, owner, event, dmg):
        return (
            dmg.target == owner.seat and dmg.source is not None and dmg.source != owner.seat
            and game.players[dmg.source].alive
        )

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        if not (yield from _ask_yes(game, owner, self, about=dmg.source)):
            return
        _announce(game, owner, self)
        j = yield from game.judge(owner.seat, self.name, lambda c: c.suit != Suit.HEART)
        src = game.players[dmg.source]
        if not j.hit or not src.alive:
            return
        choices = ["discard_two", "take_damage"] if len(src.hand) >= 2 else ["take_damage"]
        pick = yield from game.ask(ChooseOptionRequest(seat=src.seat, reason=self.name, about=owner.seat, choices=choices))
        if pick == "discard_two":
            ids = yield from game.ask(
                DiscardRequest(seat=src.seat, count=2, options=[c.id for c in src.hand], reason=self.name)
            )
            yield from game.discard(src.seat, list(ids), reason=self.name)
        else:
            yield from game.damage(owner.seat, src.seat, 1)


class NightRaid(Skill):
    """At the start of your draw phase, you may draw nothing and instead take a hand card
    from each of up to 2 other players."""

    name = "night_raid"
    events = (Event.DRAW_PHASE,)

    def _victims(self, game, owner, exclude=()) -> list[int]:
        return [s for s in _others(game, owner) if game.players[s].hand and s not in exclude]

    def can_trigger(self, game, owner, event, data):
        return data.seat == owner.seat and bool(self._victims(game, owner))

    def on_trigger(self, game, owner, event, data) -> Gen:
        chosen: list[int] = []
        for _ in range(2):
            options = self._victims(game, owner, chosen)
            if not options:
                break
            pick = yield from game.ask(
                ChoosePlayerRequest(seat=owner.seat, reason=self.name, options=options, optional=True)
            )
            if pick is None:
                break
            chosen.append(pick)
        if not chosen:
            return
        _announce(game, owner, self)
        data.count = 0
        for t in chosen:
            cid = yield from game.choose_card_from(
                owner.seat, t, reason=self.name, include_judge=False, include_equips=False
            )
            if cid is not None:
                yield from _take(game, owner.seat, t, cid, self.name)


class RecklessFury(Skill):
    """In your draw phase you may draw 1 card fewer. If you do, your Strikes and Duels deal
    +1 damage for the rest of the turn."""

    name = "reckless_fury"
    events = (Event.DRAW_PHASE, Event.DAMAGE_CAUSED)

    def can_trigger(self, game, owner, event, data):
        if event == Event.DRAW_PHASE:
            return data.seat == owner.seat and data.count > 0
        return (
            data.source == owner.seat and bool(owner.turn_usage.get("_fury"))
            and data.card is not None and data.card.name in ("strike", "duel")
        )

    def on_trigger(self, game, owner, event, data) -> Gen:
        if event == Event.DAMAGE_CAUSED:
            data.amount += 1
            return
        if (yield from _ask_yes(game, owner, self)):
            _announce(game, owner, self)
            data.count -= 1
            owner.turn_usage["_fury"] = 1


class HeavensWill(Skill):
    """After a judgment of yours takes effect, you take the judgment card."""

    name = "heavens_will"
    events = (Event.JUDGE_RESULT,)

    def can_trigger(self, game, owner, event, j):
        return j.seat == owner.seat and game.location[j.card.id][0] == Zone.PROCESSING

    def on_trigger(self, game, owner, event, j) -> Gen:
        _announce(game, owner, self)
        yield from _take_loose(game, owner.seat, [j.card.id], self.name)


class FinalStratagem(Skill):
    """For each 1 damage you take, look at the top 2 cards of the deck and give them out as
    you like, one at a time, to any players (yourself included)."""

    name = "final_stratagem"
    events = (Event.DAMAGED,)

    def can_trigger(self, game, owner, event, dmg):
        return dmg.target == owner.seat

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        for _ in range(dmg.amount):
            if not owner.alive:
                return
            _announce(game, owner, self)
            left = game._take_from_pile(2)
            while left := [i for i in left if game.location[i][0] == Zone.DRAW_PILE]:  # (a draw may take one)
                cid = left[0] if len(left) == 1 else (yield from game.ask(
                    ChooseCardRequest(
                        seat=owner.seat, reason=self.name, about=owner.seat, options=list(left),
                        shown=[game.cards[i].to_dict() for i in left],
                    )
                ))
                to = yield from game.ask(
                    ChoosePlayerRequest(
                        seat=owner.seat, reason=self.name, about=owner.seat,
                        options=[owner.seat, *_others(game, owner)],
                    )
                )
                left.remove(cid)
                card = game.cards[cid].to_dict()
                if to == owner.seat:
                    game._log("draw", seat=owner.seat, count=1, reason=self.name, private=([owner.seat], {"cards": [card]}))
                else:
                    game._log("give", seat=owner.seat, target=to, reason=self.name, private=([owner.seat, to], {"card": card}))
                yield from game.move_cards([cid], Zone.HAND, to, reason=self.name)


class GracefulEvasion(_Conversion):
    """You may play any black hand card as a Dodge."""

    name = "graceful_evasion"
    as_name = "dodge"
    in_play = False

    def fits(self, card):
        return card.is_black


class RipplingSteps(Skill):
    """At the start of your start phase, you may judge again and again: each black judgment
    card goes into your hand; the first red one ends it (and you may stop at any time)."""

    name = "rippling_steps"
    events = (Event.PHASE_START,)

    def can_trigger(self, game, owner, event, data):
        return _my_phase(game, owner, event, data, Phase.START)

    def on_trigger(self, game, owner, event, data) -> Gen:
        if not (yield from _ask_yes(game, owner, self)):
            return
        _announce(game, owner, self)
        while owner.alive:
            j = yield from game.judge(owner.seat, self.name, lambda c: c.is_black)
            if not j.hit:
                return
            if game.location[j.card.id][0] == Zone.DISCARD_PILE:
                yield from _take_loose(game, owner.seat, [j.card.id], self.name)
            if not (yield from _ask_yes(game, owner, self, context={"again": True})):
                return


# ================================================================= SHU


class OpenHand(ActiveSkill):
    """In your play phase, any number of times: give any number of hand cards to another
    player. The first time in a turn that you've given away 2 or more cards in all, recover
    1 HP."""

    name = "open_hand"
    harmful = False
    per_turn = None
    min_cards = 1
    max_cards = 99
    min_targets = max_targets = 1

    def can_activate(self, game, owner):
        return bool(owner.hand)

    def target_options(self, game, owner):
        return _others(game, owner)

    def activate(self, game, owner, cards, targets) -> Gen:
        (t,) = targets
        for cid in cards:
            yield from _give(game, owner.seat, t, cid, self.name)
        usage = owner.turn_usage
        usage["_given"] = usage.get("_given", 0) + len(cards)
        if usage["_given"] >= 2 and not usage.get("_open_hand_healed"):
            usage["_open_hand_healed"] = 1
            yield from game.recover(owner.seat, 1, source=owner.seat)


class CallToArms(ActiveSkill):
    """Lord. When you need to use or play a Strike, you may ask the other Shu characters, in
    seat order, to play one for you (in your play phase: pick the target first)."""

    name = "call_to_arms"
    lord = True
    per_turn = None
    min_targets = max_targets = 1
    assists = frozenset({"strike"})

    def _allies(self, game, owner) -> list[int]:
        return [s for s in _others(game, owner) if game.players[s].kingdom == S]

    def can_activate(self, game, owner):
        strike = game.ruleset.card_defs["strike"]
        return bool(self._allies(game, owner)) and strike.can_use(game, owner) and not owner.turn_usage.get("_rally_failed")

    def target_options(self, game, owner):
        return _strike_targets(game, owner)

    def _ask_allies(self, game, owner, about) -> Gen:
        for h in self._allies(game, owner):
            card = yield from game.respond(h, "strike", reason=self.name, about=owner.seat, context={"target": about})
            if card is not None:
                return True
        return False

    def activate(self, game, owner, cards, targets) -> Gen:
        if (yield from self._ask_allies(game, owner, targets[0])):
            yield from game.use_card(owner.seat, game.make_virtual("strike", []), targets, subcards=[])
        else:
            owner.turn_usage["_rally_failed"] = 1  # nobody answered: don't keep asking this turn

    def assist(self, game, owner, card_name, reason, about) -> Gen:
        if not self._allies(game, owner) or not (yield from _ask_yes(game, owner, self, about=about)):
            return None
        if (yield from self._ask_allies(game, owner, about)):
            return game.make_virtual("strike", [])
        return None


class CrimsonBlade(_Conversion):
    """You may use or play any red card (hand or equipment) as a Strike."""

    name = "crimson_blade"
    as_name = "strike"
    equipment = True

    def fits(self, card):
        return card.is_red


class EndlessOnslaught(Skill):
    """Locked. You may use any number of Strikes each turn."""

    name = "endless_onslaught"
    locked = True

    def extra_strikes(self, game, owner):
        return 999


class StarChart(Skill):
    """At the start of your start phase, look at the top X cards of the deck (X = living
    players, at most 5). Put any of them back on top in any order, and the rest on the bottom."""

    name = "star_chart"
    events = (Event.PHASE_START,)

    def can_trigger(self, game, owner, event, data):
        return _my_phase(game, owner, event, data, Phase.START)

    def on_trigger(self, game, owner, event, data) -> Gen:
        n = min(5, len(game.alive_players()))
        ids = game._take_from_pile(n)  # top card first; they stay in the deck
        top, bottom = yield from game.ask(
            ArrangeRequest(seat=owner.seat, reason=self.name, options=list(ids),
                           cards=[game.cards[i].to_dict() for i in ids])
        )
        moving = {*top, *bottom}
        rest = [c for c in game.draw_pile if c.id not in moving]
        game.draw_pile[:] = [*(game.cards[i] for i in reversed(bottom)), *rest, *(game.cards[i] for i in reversed(top))]
        _announce(game, owner, self)
        game._log("arrange", seat=owner.seat, top=len(top), bottom=len(bottom), reason=self.name)


class NothingToHide(Skill):
    """Locked. While you have no hand cards, you can't be targeted by Strike or Duel."""

    name = "nothing_to_hide"
    locked = True

    def can_be_targeted(self, game, owner, card_name, user):
        return bool(owner.hand) or card_name not in ("strike", "duel")


class UnwaveringSpear(ViewAs):
    """You may use or play a Strike as a Dodge, and a Dodge as a Strike."""

    name = "unwavering_spear"
    as_names = ("strike", "dodge")

    def cards_as(self, game, owner, as_name):
        want = "dodge" if as_name == "strike" else "strike"
        return [c.id for c in owner.hand if c.name == want]


class SwiftRider(Skill):
    """Locked. Your distance to other players is -1."""

    name = "swift_rider"
    locked = True

    def distance_out(self, game, owner):
        return -1


class HeadlongCharge(Skill):
    """After your Strike targets a player, you may judge: if it's red, they can't play a
    Dodge against it."""

    name = "headlong_charge"
    events = (Event.TARGET_CONFIRMED,)

    def can_trigger(self, game, owner, event, data):
        use, target = data
        return use.source == owner.seat and use.card.name == "strike" and target != owner.seat

    def on_trigger(self, game, owner, event, data) -> Gen:
        use, target = data
        if not (yield from _ask_yes(game, owner, self, about=target)):
            return
        _announce(game, owner, self)
        j = yield from game.judge(owner.seat, self.name, lambda c: c.is_red)
        if j.hit:
            use.data.setdefault("undodgeable", set()).add(target)


class Ingenuity(Skill):
    """Whenever you use a trick that isn't delayed, draw 1 card."""

    name = "ingenuity"
    events = (Event.CARD_USED,)

    def can_trigger(self, game, owner, event, use):
        d = game.card_def(use.card)
        return use.source == owner.seat and d.type == CardType.TRICK and use.card.name not in DELAYED

    def on_trigger(self, game, owner, event, use) -> Gen:
        _announce(game, owner, self)
        yield from game.draw(owner.seat, 1, reason=self.name)


class BoundlessWit(Skill):
    """Locked. Your tricks have no distance limit."""

    name = "boundless_wit"
    locked = True

    def unlimited_trick_reach(self, game, owner):
        return True


# ================================================================= WU


class WeighOptions(ActiveSkill):
    """Once per turn, in your play phase: discard any number of cards (hand or equipment),
    then draw that many."""

    name = "weigh_options"
    harmful = False
    min_cards = 1
    max_cards = 99

    def card_options(self, game, owner):
        return _owned(owner)

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.discard(owner.seat, cards, reason=self.name)
        yield from game.draw(owner.seat, len(cards), reason=self.name)


class Kinship(Skill):
    """Lord, locked. When another Wu character saves you from dying with a Peach, you
    recover 1 extra HP."""

    name = "kinship"
    lord = locked = True

    def save_bonus(self, game, owner, helper):
        return 1 if helper != owner.seat and game.players[helper].kingdom == U else 0


class PiratesRaid(_Conversion):
    """You may use any black card (hand or equipment) as a Dismantle."""

    name = "pirates_raid"
    as_name = "dismantle"
    equipment = True
    in_response = False

    def fits(self, card):
        return card.is_black


class BideTime(Skill):
    """If you didn't use or play a Strike this turn, you skip your discard phase."""

    name = "bide_time"
    events = (Event.PHASE_END,)

    def can_trigger(self, game, owner, event, data):
        # checked as the play phase ends, or as the draw phase ends if the play phase will be skipped
        when = data == Phase.PLAY or (data == Phase.DRAW and Phase.PLAY in owner.skip_phases)
        return (
            when and game.current == owner.seat and not owner.turn_usage.get("_strikes")
            and len(owner.hand) > game.hand_limit(owner) and Phase.DISCARD not in owner.skip_phases
        )

    def on_trigger(self, game, owner, event, data) -> Gen:
        _announce(game, owner, self)
        owner.skip_phases.add(Phase.DISCARD)
        yield from ()


class BitterGambit(ActiveSkill):
    """In your play phase, any number of times: lose 1 HP, then draw 2 cards."""

    name = "bitter_gambit"
    harmful = False
    per_turn = None

    def can_activate(self, game, owner):
        return owner.hp > 0

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.lose_hp(owner.seat, 1, reason=self.name)
        if owner.alive:
            yield from game.draw(owner.seat, 2, reason=self.name)


class Dashing(Skill):
    """Locked. You draw 1 extra card in your draw phase."""

    name = "dashing"
    locked = True
    events = (Event.DRAW_PHASE,)

    def can_trigger(self, game, owner, event, data):
        return data.seat == owner.seat

    def on_trigger(self, game, owner, event, data) -> Gen:
        data.count += 1
        yield from ()


SUITS = [str(s) for s in (Suit.SPADE, Suit.HEART, Suit.CLUB, Suit.DIAMOND)]


class FalseLetter(ActiveSkill):
    """Once per turn, in your play phase, if you have hand cards: choose another player. They
    name a suit, then you choose one of your hand cards and give it to them, face up. If it
    isn't the suit they named, they take 1 damage from you."""

    name = "false_letter"
    min_targets = max_targets = 1

    def can_activate(self, game, owner):
        return bool(owner.hand)

    def target_options(self, game, owner):
        return _others(game, owner)

    def activate(self, game, owner, cards, targets) -> Gen:
        (t,) = targets
        suit = yield from game.ask(ChooseOptionRequest(seat=t, reason=self.name, about=owner.seat, choices=SUITS))
        game._log("named_suit", seat=t, suit=suit, reason=self.name)
        if not owner.hand:
            return
        (cid,) = yield from game.ask(
            DiscardRequest(
                seat=owner.seat, count=1, options=[c.id for c in owner.hand], reason=self.name,
                about=t, context={"suit": suit},
            )
        )
        card = game.cards[cid]
        game._log("give", seat=owner.seat, target=t, reason=self.name, card=card.to_dict())  # shown face up
        yield from game.move_cards([cid], Zone.HAND, t, reason=self.name)
        if str(card.suit) != suit:
            yield from game.damage(owner.seat, t, 1)


class Captivate(_Conversion):
    """You may use any Diamond ♦ card (hand or equipment) as an Indulgence."""

    name = "captivate"
    as_name = "indulgence"
    equipment = True
    in_response = False

    def fits(self, card):
        return card.suit == Suit.DIAMOND


class Deflect(Skill):
    """When you become the target of a Strike, you may discard a card (hand or equipment) to
    pass the Strike to another player in your attack range (not the one who used it)."""

    name = "deflect"
    events = (Event.BECOME_TARGET,)

    def _onto(self, game, owner, use) -> list[int]:
        user = game.players[use.source]
        return [
            s for s in _others(game, owner)
            if s != use.source and s not in use.targets and game.in_attack_range(owner.seat, s)
            and game.targetable(user, s, "strike")
        ]

    def can_trigger(self, game, owner, event, data):
        use, target = data
        return (
            target == owner.seat and use.card.name == "strike" and use.source != owner.seat
            and bool(_owned(owner)) and bool(self._onto(game, owner, use))
        )

    def on_trigger(self, game, owner, event, data) -> Gen:
        use, _ = data
        to = yield from game.ask(
            ChoosePlayerRequest(seat=owner.seat, reason=self.name, about=use.source, options=self._onto(game, owner, use), optional=True)
        )
        if to is None:
            return
        _announce(game, owner, self)
        ids = yield from game.ask(DiscardRequest(seat=owner.seat, count=1, options=_owned(owner), reason=self.name))
        yield from game.discard(owner.seat, list(ids), reason=self.name)
        use.data["redirect"] = to


class LowProfile(Skill):
    """Locked. You can't be targeted by Snatch or Indulgence."""

    name = "low_profile"
    locked = True

    def can_be_targeted(self, game, owner, card_name, user):
        return card_name not in ("snatch", "indulgence")


class EndlessSupply(Skill):
    """Whenever you lose your last hand card, draw 1 card."""

    name = "endless_supply"
    events = (Event.CARDS_MOVED,)

    def can_trigger(self, game, owner, event, moved):
        return not owner.hand and bool(moved.left(Zone.HAND, owner.seat))

    def on_trigger(self, game, owner, event, moved) -> Gen:
        _announce(game, owner, self)
        yield from game.draw(owner.seat, 1, reason=self.name)


class WeddingVow(ActiveSkill):
    """Once per turn, in your play phase: discard 2 hand cards and choose a wounded male
    character. You and they each recover 1 HP."""

    name = "wedding_vow"
    harmful = False
    min_cards = max_cards = 2
    min_targets = max_targets = 1

    def card_options(self, game, owner):
        return [c.id for c in owner.hand]

    def target_options(self, game, owner):
        return [s for s in _others(game, owner) if game.players[s].gender == "male" and game.players[s].is_wounded]

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.discard(owner.seat, cards, reason=self.name)
        yield from game.recover(owner.seat, 1, source=owner.seat)
        yield from game.recover(targets[0], 1, source=owner.seat)


class SpareArms(Skill):
    """Whenever you lose a card from your equipment area, draw 2 cards."""

    name = "spare_arms"
    events = (Event.CARDS_MOVED,)

    def can_trigger(self, game, owner, event, moved):
        return bool(moved.left(Zone.EQUIP, owner.seat))

    def on_trigger(self, game, owner, event, moved) -> Gen:
        _announce(game, owner, self)
        yield from game.draw(owner.seat, 2 * len(moved.left(Zone.EQUIP, owner.seat)), reason=self.name)


# ================================================================= QUN


class EmergencyCure(_Conversion):
    """Outside your turn, you may play any red card (hand or equipment) as a Peach."""

    name = "emergency_cure"
    as_name = "peach"
    equipment = True
    in_play = False

    def enabled(self, game, owner):
        return game.current != owner.seat

    def fits(self, card):
        return card.is_red


class HealingHerbs(ActiveSkill):
    """Once per turn, in your play phase: discard a hand card to have a wounded character
    (you too) recover 1 HP."""

    name = "healing_herbs"
    harmful = False
    min_cards = max_cards = 1
    min_targets = max_targets = 1

    def target_options(self, game, owner):
        return [p.seat for p in game.alive_players() if p.is_wounded]

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.discard(owner.seat, cards, reason=self.name)
        yield from game.recover(targets[0], 1, source=owner.seat)


class UnmatchedMight(Skill):
    """Locked. Your Strikes take 2 Dodges to cancel. In a Duel with you, the other side must
    play 2 Strikes each time."""

    name = "unmatched_might"
    locked = True

    def demands_double(self, game, owner):
        return True


class Rivalry(ActiveSkill):
    """Once per turn, in your play phase: discard a card (hand or equipment) and choose two
    male characters. The first uses a Duel on the second; it can't be Nullified."""

    name = "rivalry"
    min_cards = max_cards = 1
    min_targets = max_targets = 2

    def card_options(self, game, owner):
        return _owned(owner)

    def target_options(self, game, owner):
        return [s for s in _others(game, owner) if game.players[s].gender == "male"]

    def check(self, game, owner, cards, targets):
        if len(targets) != 2:
            return None  # (the request itself checks the count)
        first, second = targets
        if not game.targetable(game.players[first], second, "duel"):
            return "that player can't be challenged to a Duel"
        return None

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.discard(owner.seat, cards, reason=self.name)
        first, second = targets
        if game.players[first].alive and game.players[second].alive:
            duel = game.make_virtual("duel", [])
            yield from game.use_card(first, duel, [second], subcards=[], data={"unnullifiable": True, "via": self.name})


class EveningGrace(Skill):
    """Locked. At the start of your end phase, draw 1 card."""

    name = "evening_grace"
    locked = True
    events = (Event.PHASE_START,)

    def can_trigger(self, game, owner, event, data):
        return _my_phase(game, owner, event, data, Phase.END)

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.draw(owner.seat, 1, reason=self.name)


# ================================================================= extras (our own designs)


class SpoilsOfWar(Skill):
    """Locked. Whenever you take damage, put the physical card(s) that dealt it into your hand
    (all of them, if they were converted into one card). If there are none, draw 1 card."""

    name = "spoils_of_war"
    locked = True
    events = (Event.DAMAGED,)

    def can_trigger(self, game, owner, event, dmg):
        return dmg.target == owner.seat

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        loot = _dealt_by(game, dmg)
        if not loot:
            yield from game.draw(owner.seat, 1, reason=self.name)
            return
        yield from _take_loose(game, owner.seat, loot, self.name)


class ShieldWall(_AskAllies):
    """Lord. Whenever you need to play a Dodge, you may ask the other Wei characters, in seat
    order, to play one for you (their armor may help them do it)."""

    name = "shield_wall"
    lord = True
    assists = frozenset({"dodge"})


class Omen(Skill):
    """Once per turn, before any judgment's result is decided, you may discard the judgment
    card and reveal a new one in its place."""

    name = "omen"
    per_turn = 1
    events = (Event.JUDGE_CARD,)

    def can_trigger(self, game, owner, event, j):
        return game.skill_ready(owner, self)

    def on_trigger(self, game, owner, event, j) -> Gen:
        ok = yield from game.ask(
            ConfirmRequest(
                seat=owner.seat,
                reason=self.name,
                about=j.seat,
                context={
                    "judge_reason": j.reason,
                    "card": j.card.to_dict(),
                    "would_hit": bool(j.hits and j.hits(j.card)),
                },
            )
        )
        if not ok:
            return
        game.note_skill_used(owner, self)
        old = j.card
        (new_id,) = game._take_from_pile(1)
        yield from game.move_cards([old.id], Zone.DISCARD_PILE, reason=self.name)
        yield from game.move_cards([new_id], Zone.PROCESSING, reason=self.name)
        j.card = game.cards[new_id]
        game._log("rejudge", seat=owner.seat, old=old.to_dict(), card=j.card.to_dict())


class Hermit(Skill):
    """Locked. Other players' distance to you is +1."""

    name = "hermit"
    locked = True

    def distance_in(self, game, owner):
        return 1


# ================================================================= modern heroes (designed at our table)


AURA_MAX = 4


def _basics(game, p) -> list[int]:
    return [c.id for c in p.hand if game.card_def(c).type == CardType.BASIC]


class AuraFarmer(Skill):
    """Locked. When your turn ends, if you didn't use or play a Strike this turn, gain 1 Aura
    token (at most 4)."""

    name = "aura_farmer"
    locked = True
    events = (Event.TURN_END,)

    def can_trigger(self, game, owner, event, p):
        return p is owner and not owner.turn_usage.get("_strikes") and owner.tokens.get("aura", 0) < AURA_MAX

    def on_trigger(self, game, owner, event, p) -> Gen:
        game.set_token(owner.seat, "aura", owner.tokens.get("aura", 0) + 1)
        yield from ()


class DoNothingWin(ActiveSkill):
    """In your play phase, any number of times: spend 1 Aura token to look at the top 2 cards
    of the deck. Take 1 of them into your hand and discard the other."""

    name = "do_nothing_win"
    harmful = False
    per_turn = None

    def can_activate(self, game, owner):
        return owner.tokens.get("aura", 0) > 0

    def activate(self, game, owner, cards, targets) -> Gen:
        game.set_token(owner.seat, "aura", owner.tokens.get("aura", 0) - 1)
        ids = game._take_from_pile(2)
        cid = yield from game.ask(
            ChooseCardRequest(seat=owner.seat, reason=self.name, options=list(ids),
                              shown=[game.cards[i].to_dict() for i in ids])
        )
        game._log("draw", seat=owner.seat, count=1, reason=self.name,
                  private=([owner.seat], {"cards": [game.cards[cid].to_dict()]}))
        yield from game.move_cards([cid], Zone.HAND, owner.seat, reason=self.name)
        rest = [i for i in ids if i != cid and game.location[i][0] == Zone.DRAW_PILE]
        if rest:
            yield from game.discard(owner.seat, rest, reason=self.name)


class WhatsUpBeijing(ActiveSkill, Skill):
    """Lord, limited. In your play phase, if you haven't used a card yet this turn: show your
    whole hand. Until your next turn starts, your distance to every other player is 1, and
    everyone else's distance to you is +99."""

    name = "whats_up_beijing"
    lord = limited = True
    harmful = False
    events = (Event.TURN_START,)

    def can_activate(self, game, owner):
        return not owner.turn_usage.get("_cards_used")

    def activate(self, game, owner, cards, targets) -> Gen:
        game._log("show_hand", seat=owner.seat, cards=[c.to_dict() for c in owner.hand], reason=self.name)
        game.set_token(owner.seat, "beijing", 1)
        yield from ()

    def can_trigger(self, game, owner, event, p):  # it wears off as your next turn starts
        return p is owner and bool(owner.tokens.get("beijing"))

    def on_trigger(self, game, owner, event, p) -> Gen:
        game.set_token(owner.seat, "beijing", 0)
        yield from ()

    def distance_out(self, game, owner):
        return -999 if owner.tokens.get("beijing") else 0  # (distances never go below 1)

    def distance_in(self, game, owner):
        return 99 if owner.tokens.get("beijing") else 0


class Communism(_Conversion):
    """Once per turn, you may use a red basic card as a Bountiful Harvest."""

    name = "communism"
    as_name = "harvest"
    per_turn = 1
    in_response = False

    def cards(self, game, owner):
        return [c.id for c in owner.hand if c.is_red and game.card_def(c).type == CardType.BASIC]


class Sharing(ActiveSkill):
    """Once per turn, in your play phase: choose a player with the most hand cards, then a
    player with the fewest (you may be either). The first gives the second a random hand card."""

    name = "sharing"
    min_targets = max_targets = 2

    @staticmethod
    def _extremes(game) -> tuple[int, int]:
        counts = [len(p.hand) for p in game.alive_players()]
        return max(counts), min(counts)

    def can_activate(self, game, owner):
        return self._extremes(game)[0] > 0

    def target_options(self, game, owner):
        hi, lo = self._extremes(game)
        return [s for s in game.seats_from(owner.seat) if game.players[s].alive and len(game.players[s].hand) in (hi, lo)]

    def check(self, game, owner, cards, targets):
        if len(targets) != 2:
            return None
        hi, lo = self._extremes(game)
        giver, taker = targets
        if len(game.players[giver].hand) != hi:
            return "the first player must have the most hand cards"
        if len(game.players[taker].hand) != lo:
            return "the second player must have the fewest hand cards"
        return None

    def activate(self, game, owner, cards, targets) -> Gen:
        giver, taker = (game.players[s] for s in targets)
        if giver.hand and giver.alive and taker.alive:
            yield from _give(game, giver.seat, taker.seat, game.rng.choice(giver.hand).id, self.name)


TARIFF_CHOICES = ("tariff_give", "tariff_discard")


class Tariffs(ActiveSkill, Skill):
    """Once per turn, in your play phase: put a Tariff on another player who has none. At the
    start of their turn, you may remove it and discard a card (hand or equipment). They then
    choose: give you a random hand card, or discard two cards (hand or equipment)."""

    name = "tariffs"
    min_targets = max_targets = 1
    events = (Event.TURN_START,)

    def target_options(self, game, owner):
        return [s for s in _others(game, owner) if not game.players[s].tokens.get("tariff")]

    def activate(self, game, owner, cards, targets) -> Gen:
        (t,) = targets
        game.players[t].marks["tariff_by"] = owner.seat
        game.set_token(t, "tariff", 1)
        yield from ()

    @staticmethod
    def _choices(game, p) -> list[str]:
        out = []
        if p.hand:
            out.append("tariff_give")
        if len(_owned(p)) >= 2:
            out.append("tariff_discard")
        return out

    def can_trigger(self, game, owner, event, p):
        return (
            p is not owner and bool(p.tokens.get("tariff")) and p.marks.get("tariff_by") == owner.seat
            and bool(_owned(owner)) and bool(self._choices(game, p))
        )

    def on_trigger(self, game, owner, event, p) -> Gen:
        if not (yield from _ask_yes(game, owner, self, about=p.seat)):
            return  # the Tariff stays for later
        _announce(game, owner, self)
        game.set_token(p.seat, "tariff", 0)
        p.marks.pop("tariff_by", None)
        (cid,) = yield from game.ask(
            DiscardRequest(seat=owner.seat, count=1, options=_owned(owner), reason=self.name, about=p.seat)
        )
        yield from game.discard(owner.seat, [cid], reason=self.name)
        choices = self._choices(game, p)
        if not choices or not p.alive:
            return
        pick = yield from game.ask(ChooseOptionRequest(seat=p.seat, reason=self.name, about=owner.seat, choices=choices))
        game._log("chose", seat=p.seat, choice=pick, reason=self.name)
        if pick == "tariff_give":
            if p.hand and owner.alive:
                yield from _give(game, p.seat, owner.seat, game.rng.choice(p.hand).id, self.name)
        else:
            ids = yield from game.ask(
                DiscardRequest(seat=p.seat, count=2, options=_owned(p), reason="tariff_penalty", about=owner.seat)
            )
            yield from game.discard(p.seat, list(ids), reason=self.name)


class DodgedABullet(Skill):
    """Lord, limited. When you are dying and nobody saves you, you may go back to 1 HP and draw
    1 card."""

    name = "dodged_a_bullet"
    lord = limited = True
    events = (Event.UNSAVED,)

    def can_trigger(self, game, owner, event, seat):
        return seat == owner.seat and game.skill_ready(owner, self)

    def on_trigger(self, game, owner, event, seat) -> Gen:
        if not (yield from _ask_yes(game, owner, self)):
            return
        game.note_skill_used(owner, self)
        _announce(game, owner, self)
        yield from game.recover(owner.seat, 1 - owner.hp, source=owner.seat)
        yield from game.draw(owner.seat, 1, reason=self.name)


class BabyOil(ActiveSkill, Skill):
    """Once per turn, in your play phase: discard a card (hand or equipment) to put a Slippery
    marker on another player. After you take damage, you may also put one on the player who
    dealt it (at most 1 marker per player). Slippery: whenever the marked player uses a card
    during their turn, they must judge. If it's black, that card has no effect (it goes to the
    discard pile) and the marker is removed. Otherwise, the marker is removed at the end of
    their turn."""

    name = "baby_oil"
    min_cards = max_cards = 1
    min_targets = max_targets = 1
    events = (Event.DAMAGED,)

    def card_options(self, game, owner):
        return _owned(owner)

    def target_options(self, game, owner):
        return [s for s in _others(game, owner) if not game.players[s].tokens.get("slippery")]

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.discard(owner.seat, cards, reason=self.name)
        if game.players[targets[0]].alive:
            game.set_token(targets[0], "slippery", 1)

    def can_trigger(self, game, owner, event, dmg):
        if dmg.target != owner.seat or dmg.source is None or dmg.source == owner.seat:
            return False
        src = game.players[dmg.source]
        return src.alive and not src.tokens.get("slippery")

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        if (yield from _ask_yes(game, owner, self, about=dmg.source)):
            _announce(game, owner, self)
            game.set_token(dmg.source, "slippery", 1)


class Slippery(Skill):
    """Whenever you use a card during your turn, judge: if it's black, the card has no effect
    (it goes to the discard pile) and you're no longer Slippery. Otherwise it wears off when
    your turn ends."""

    name = "slippery"
    events = (Event.CARD_USED, Event.TURN_END)

    def can_trigger(self, game, owner, event, data):
        if not owner.tokens.get("slippery"):
            return False
        if event == Event.TURN_END:
            return data is owner
        return data.source == owner.seat and game.current == owner.seat and not data.data.get("void")

    def on_trigger(self, game, owner, event, data) -> Gen:
        if event == Event.TURN_END:
            game.set_token(owner.seat, "slippery", 0)
            return
        _announce(game, owner, self)
        j = yield from game.judge(owner.seat, self.name, lambda c: c.is_black)
        if j.hit:
            data.data["void"] = self.name
            if data.card.name == "strike" and not data.data.get("free"):
                owner.strikes_used += 1  # a Strike that slipped still counts as used
            game.set_token(owner.seat, "slippery", 0)


def _has_horse(game, p) -> bool:
    return any(game.equip_in(p, slot) is not None for slot in (EquipSlot.PLUS_HORSE, EquipSlot.MINUS_HORSE))


class Tesla(ViewAs):
    """Once per turn, while you have a +1 or -1 Horse equipped, you may use or play any hand
    card as a Strike or a Dodge."""

    name = "tesla"
    as_names = ("strike", "dodge")
    per_turn = 1

    def enabled(self, game, owner):
        return _has_horse(game, owner)


class SpaceX(Skill):
    """Once per turn, at the start of your play phase, you may discard all your equipment (at
    least 2 cards) to Launch: draw that many cards, and for the rest of this play phase your
    Strike limit is raised by the number of cards you discarded (2 to 4) and your Strikes deal +1
    damage."""

    name = "spacex"
    per_turn = 1
    events = (Event.PHASE_START, Event.PHASE_END, Event.DAMAGE_CAUSED)

    def can_trigger(self, game, owner, event, data):
        launched = owner.turn_usage.get("_launch") == 1
        if event == Event.PHASE_START:
            return _my_phase(game, owner, event, data, Phase.PLAY) and game.skill_ready(owner, self) and len(owner.equips) >= 2
        if event == Event.PHASE_END:
            return data == Phase.PLAY and game.current == owner.seat and launched
        return launched and data.source == owner.seat and data.card is not None and data.card.name == "strike"

    def on_trigger(self, game, owner, event, data) -> Gen:
        if event == Event.DAMAGE_CAUSED:
            data.amount += 1
            return
        if event == Event.PHASE_END:  # touchdown: the play phase is over
            owner.turn_usage["_launch"] = 2
            game.set_token(owner.seat, "launch", 0)
            return
        if not (yield from _ask_yes(game, owner, self)):
            return
        game.note_skill_used(owner, self)
        _announce(game, owner, self)
        gear = owner.turn_usage["_launch_gear"] = len(owner.equips)
        yield from game.discard(owner.seat, [c.id for c in owner.equips], reason=self.name)
        yield from game.draw(owner.seat, gear, reason=self.name)  # fuel for the flight
        owner.turn_usage["_launch"] = 1  # launched, from here to the end of this play phase
        game.set_token(owner.seat, "launch", 1)

    def extra_strikes(self, game, owner):
        # Strikes used earlier in the turn still count against the raised limit.
        return owner.turn_usage.get("_launch_gear", 0) if owner.turn_usage.get("_launch") == 1 else 0


class DeepSeek(ActiveSkill):
    """Once per turn, in your play phase: discard a card (hand or equipment) to reveal the top
    3 cards of the deck. Take 1 of them into your hand and put the rest on the bottom of the
    deck."""

    name = "deepseek"
    harmful = False
    min_cards = max_cards = 1

    def card_options(self, game, owner):
        return _owned(owner)

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.discard(owner.seat, cards, reason=self.name)
        ids = game._take_from_pile(3)
        faces = [game.cards[i].to_dict() for i in ids]
        game._log("reveal", reason=self.name, cards=faces)
        cid = yield from game.ask(ChooseCardRequest(seat=owner.seat, reason=self.name, options=list(ids), shown=faces))
        game._log("pick", seat=owner.seat, card=game.cards[cid].to_dict())
        yield from game.move_cards([cid], Zone.HAND, owner.seat, reason=self.name)
        rest = [i for i in ids if i != cid and game.location[i][0] == Zone.DRAW_PILE]
        moving = set(rest)
        game.draw_pile[:] = [*(game.cards[i] for i in rest), *(c for c in game.draw_pile if c.id not in moving)]
        game._log("arrange", seat=owner.seat, top=0, bottom=len(rest), reason=self.name)


class Distillation(Skill):
    """Once per turn, after another player uses a trick in their play phase, you may discard a
    basic hand card to use a copy of that trick yourself (you choose its targets)."""

    name = "distillation"
    per_turn = 1
    events = (Event.CARD_FINISHED,)

    def _spec(self, game, owner, use):
        d = game.card_def(use.card)
        if d.type != CardType.TRICK or use.card.name == "nullify":
            return None
        return game._target_spec(owner, d, whole_hand=False)

    def can_trigger(self, game, owner, event, use):
        return (
            use.source != owner.seat and game.current == use.source and game.phase == Phase.PLAY
            and game.skill_ready(owner, self) and bool(_basics(game, owner))
            and self._spec(game, owner, use) is not None
        )

    def on_trigger(self, game, owner, event, use) -> Gen:
        name = use.card.name
        cid = yield from game.ask(
            ChooseCardRequest(seat=owner.seat, reason=self.name, about=owner.seat, options=_basics(game, owner),
                              optional=True, context={"card": name, "source": use.source})
        )
        if cid is None:
            return
        spec = self._spec(game, owner, use)
        if spec is None:
            return
        most, least, cands = spec
        targets: list[int] = []
        need = 0 if not most else max(1, most if least is None else least)
        while len(targets) < most:
            left = [s for s in cands if s not in targets]
            if not left:
                break
            pick = yield from game.ask(
                ChoosePlayerRequest(seat=owner.seat, reason=self.name, about=use.source, options=left,
                                    optional=len(targets) >= need)
            )
            if pick is None:
                break
            targets.append(pick)
        game.note_skill_used(owner, self)
        card = game.make_virtual(name, [cid], use.card.nature)
        game._virtual_via[card.id] = self.name
        yield from game.use_card(owner.seat, card, targets, subcards=[cid])


# ================================================================= roster


HEROES: list[Hero] = [
    # Wei
    Hero("cao_cao", "Cao Cao", W, 4, "male", (ProfitFromLoss(), GuardTheThrone())),
    Hero("sima_yi", "Sima Yi", W, 3, "male", (TitForTat(), BendFate())),
    Hero("xiahou_dun", "Xiahou Dun", W, 4, "male", (BloodForBlood(),)),
    Hero("zhang_liao", "Zhang Liao", W, 4, "male", (NightRaid(),)),
    Hero("xu_chu", "Xu Chu", W, 4, "male", (RecklessFury(),)),
    Hero("guo_jia", "Guo Jia", W, 3, "male", (HeavensWill(), FinalStratagem())),
    Hero("zhen_ji", "Zhen Ji", W, 3, "female", (GracefulEvasion(), RipplingSteps())),
    # Shu
    Hero("liu_bei", "Liu Bei", S, 4, "male", (OpenHand(), CallToArms())),
    Hero("guan_yu", "Guan Yu", S, 4, "male", (CrimsonBlade(),)),
    Hero("zhang_fei", "Zhang Fei", S, 4, "male", (EndlessOnslaught(),)),
    Hero("zhuge_liang", "Zhuge Liang", S, 3, "male", (StarChart(), NothingToHide())),
    Hero("zhao_yun", "Zhao Yun", S, 4, "male", (UnwaveringSpear(),)),
    Hero("ma_chao", "Ma Chao", S, 4, "male", (SwiftRider(), HeadlongCharge())),
    Hero("huang_yueying", "Huang Yueying", S, 3, "female", (Ingenuity(), BoundlessWit())),
    # Wu
    Hero("sun_quan", "Sun Quan", U, 4, "male", (WeighOptions(), Kinship())),
    Hero("gan_ning", "Gan Ning", U, 4, "male", (PiratesRaid(),)),
    Hero("lu_meng", "Lü Meng", U, 4, "male", (BideTime(),)),
    Hero("huang_gai", "Huang Gai", U, 4, "male", (BitterGambit(),)),
    Hero("zhou_yu", "Zhou Yu", U, 3, "male", (Dashing(), FalseLetter())),
    Hero("da_qiao", "Da Qiao", U, 3, "female", (Captivate(), Deflect())),
    Hero("lu_xun", "Lu Xun", U, 3, "male", (LowProfile(), EndlessSupply())),
    Hero("sun_shangxiang", "Sun Shangxiang", U, 3, "female", (WeddingVow(), SpareArms())),
    # Qun
    Hero("hua_tuo", "Hua Tuo", Q, 3, "male", (EmergencyCure(), HealingHerbs())),
    Hero("lu_bu", "Lü Bu", Q, 4, "male", (UnmatchedMight(),)),
    Hero("diaochan", "Diaochan", Q, 3, "female", (Rivalry(), EveningGrace())),
    # extras: our own designs
    Hero("wei_lie", "Wei Lie", W, 4, "male", (SpoilsOfWar(), ShieldWall())),
    Hero("yu_ji", "Yu Ji", Q, 3, "male", (Omen(), Hermit())),
    # modern heroes: designed at our table
    Hero("chairman", "The Chairman", Q, 4, "male", (AuraFarmer(), DoNothingWin(), WhatsUpBeijing()), custom=True),
    Hero("marks", "Marks", Q, 3, "male", (Communism(), Sharing()), custom=True),
    Hero("donald", "Donald", Q, 4, "male", (Tariffs(), DodgedABullet()), custom=True),
    Hero("diddy", "Diddy", Q, 4, "male", (BabyOil(),), custom=True),
    Hero("yilong_ma", "Yilong Ma", Q, 4, "male", (Tesla(), SpaceX()), custom=True),
    Hero("mr_liang", "Mr. Liang", Q, 3, "male", (DeepSeek(), Distillation()), custom=True),
]

HERO_MAP: dict[str, Hero] = {h.id: h for h in HEROES}
MODERN = ("chairman", "marks", "donald", "diddy", "yilong_ma", "mr_liang")

# Status skills that come with a token on a player (Baby Oil's "slippery" marker).
STATUSES = {"slippery": Slippery()}

# Skills a hero can gain during play (not on any starting kit), listed for clients.
GAINED_SKILLS: list = [*STATUSES.values()]
