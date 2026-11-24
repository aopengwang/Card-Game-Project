"""Trick cards: instant tricks (resolved per target, each nullifiable) and delayed tricks
(placed in a judge area, resolved by judgment at the owner's judge phase).
"""
from __future__ import annotations

import dataclasses

from engine import (
    HAND,
    Card,
    CardDef,
    CardType,
    CardUse,
    ChooseCardRequest,
    ChoosePlayerRequest,
    EquipSlot,
    Event,
    Game,
    Phase,
    Player,
    Suit,
    Zone,
)
from engine.model import Gen


def _others(game: Game, user: Player) -> list[int]:
    """Other living players in seat order starting after `user`."""
    return [s for s in game.seats_from(user.seat)[1:] if game.players[s].alive]


def _everyone(game: Game, user: Player) -> list[int]:
    return [s for s in game.seats_from(user.seat) if game.players[s].alive]


def _has_cards(p: Player) -> bool:
    return bool(p.hand or p.equips or p.judge)


# ---------------------------------------------------------------- instant tricks


class InstantTrick(CardDef):
    type = CardType.TRICK
    harmful = False  # hint for bots / UI

    def can_use(self, game: Game, user: Player) -> bool:
        return True

    def resolves_on(self, game: Game, use: CardUse, target: int) -> bool:
        """Skip targets the effect would do nothing to (no nullify window either)."""
        return True

    def before(self, game: Game, use: CardUse) -> Gen:
        yield from ()

    def effect(self, game: Game, use: CardUse, target: int) -> Gen:
        yield from ()

    def after(self, game: Game, use: CardUse) -> Gen:
        yield from ()

    def on_use(self, game: Game, use: CardUse) -> Gen:
        yield from self.before(game, use)
        for t in use.targets:
            if not game.players[t].alive or not self.resolves_on(game, use, t):
                continue
            yield from game.trigger(Event.TARGET_CONFIRMED, (use, t))
            if t in use.cancelled:
                continue
            if not use.data.get("unnullifiable") and (yield from game.nullified(use.card, use.source, t)):
                continue
            yield from self.effect(game, use, t)
        yield from self.after(game, use)


class ExNihilo(InstantTrick):
    """Draw 2 cards."""

    name = "ex_nihilo"

    def auto_targets(self, game, user):
        return [user.seat]

    def effect(self, game, use, target):
        yield from game.draw(target, 2, reason="ex_nihilo")


class Dismantle(InstantTrick):
    """Discard one card (hand, equipment or judge area) of another player."""

    name = "dismantle"
    harmful = True
    target_count = 1

    def candidates(self, game, user):
        return [s for s in _others(game, user) if _has_cards(game.players[s])]

    def effect(self, game, use, target):
        cid = yield from game.choose_card_from(use.source, target, reason="dismantle")
        if cid is not None:
            yield from game.discard(target, [cid], reason="dismantle")


class Snatch(InstantTrick):
    """Take one card from a player at distance 1."""

    name = "snatch"
    harmful = True
    target_count = 1

    def candidates(self, game, user):
        reach = game.trick_reach(user)
        return [
            s
            for s in _others(game, user)
            if _has_cards(game.players[s]) and game.distance(user.seat, s) <= reach
        ]

    def effect(self, game, use, target):
        cid = yield from game.choose_card_from(use.source, target, reason="snatch")
        if cid is None:
            return
        card = game.cards[cid]
        zone = game.location[cid][0]
        if zone == Zone.HAND:
            game._log(
                "take", seat=use.source, target=target, zone=str(zone),
                private=([use.source, target], {"card": card.to_dict()}),
            )
        else:
            game._log("take", seat=use.source, target=target, zone=str(zone), card=card.to_dict())
        yield from game.move_cards([cid], Zone.HAND, use.source, reason="snatch")


class Duel(InstantTrick):
    """Target and user alternately play Strike, target first; whoever can't takes 1 damage."""

    name = "duel"
    harmful = True
    target_count = 1

    def candidates(self, game, user):
        return _others(game, user)

    def effect(self, game, use, target):
        turn, other = target, use.source
        while True:
            if not game.players[turn].alive or not game.players[other].alive:
                return
            need = 2 if game.doubled(other) else 1  # facing someone who demands double
            for i in range(need):
                strike = yield from game.respond(
                    turn, "strike", reason="duel", about=other, context={"need": need, "got": i} if need > 1 else None
                )
                if strike is None:
                    yield from game.damage(other, turn, 1 + use.damage_bonus, card=use.card)
                    return
            turn, other = other, turn


class _AreaAttack(InstantTrick):
    harmful = True
    answer_with = ""

    def auto_targets(self, game, user):
        return _others(game, user)

    def effect(self, game, use, target):
        card = yield from game.respond(target, self.answer_with, reason=self.name, about=use.source, use=use)
        if card is None:
            yield from game.damage(use.source, target, 1 + use.damage_bonus, card=use.card)


class Barbarians(_AreaAttack):
    """Every other player plays a Strike or takes 1 damage."""

    name = "barbarians"
    answer_with = "strike"


class Arrows(_AreaAttack):
    """Every other player plays a Dodge or takes 1 damage."""

    name = "arrows"
    answer_with = "dodge"


class PeachGarden(InstantTrick):
    """Every living player recovers 1 HP."""

    name = "peach_garden"

    def auto_targets(self, game, user):
        return _everyone(game, user)

    def resolves_on(self, game, use, target):
        return game.players[target].is_wounded

    def effect(self, game, use, target):
        yield from game.recover(target, 1, source=use.source)


class Harvest(InstantTrick):
    """Reveal one card per living player; each, in order, takes one."""

    name = "harvest"

    def auto_targets(self, game, user):
        return _everyone(game, user)

    def before(self, game, use):
        ids = game._take_from_pile(len(use.targets))
        use.data["revealed"] = ids
        game._log("reveal", reason="harvest", cards=[game.cards[i].to_dict() for i in ids])
        yield from game.move_cards(ids, Zone.PROCESSING, reason="harvest")

    def effect(self, game, use, target):
        left = [i for i in use.data["revealed"] if game.location[i][0] == Zone.PROCESSING]
        if not left:
            return
        cid = yield from game.ask(ChooseCardRequest(seat=target, reason="harvest", options=left))
        game._log("pick", seat=target, card=game.cards[cid].to_dict())
        yield from game.move_cards([cid], Zone.HAND, target, reason="harvest")

    def after(self, game, use):
        left = [game.cards[i] for i in use.data["revealed"] if game.location[i][0] == Zone.PROCESSING]
        yield from game._flush_processing(*left)


class BorrowedSword(InstantTrick):
    """Pick a player with a weapon and someone in their attack range: they must use a
    Strike on that person, or hand you their weapon."""

    name = "borrowed_sword"
    harmful = True
    target_count = 1

    @staticmethod
    def victims(game: Game, wielder: int) -> list[int]:
        reach = game.attack_range(game.players[wielder])
        return [
            p.seat for p in game.alive_players() if p.seat != wielder and game.distance(wielder, p.seat) <= reach
        ]

    def candidates(self, game, user):
        return [
            s
            for s in _others(game, user)
            if game.equip_in(game.players[s], EquipSlot.WEAPON) is not None and self.victims(game, s)
        ]

    def before(self, game, use):
        wielder = use.targets[0]
        victim = yield from game.ask(
            ChoosePlayerRequest(
                seat=use.source, reason="borrowed_sword", about=wielder, options=self.victims(game, wielder)
            )
        )
        use.data["victim"] = victim
        game._log("borrowed_sword", seat=use.source, wielder=wielder, victim=victim)

    def effect(self, game, use, target):
        victim = use.data["victim"]
        if game.players[victim].alive:
            strike = yield from game.use_strike(
                target, victim, reason="borrowed_sword", context={"source": use.source, "victim": victim}
            )
            if strike is not None:
                return
        weapon = game.equip_in(game.players[target], EquipSlot.WEAPON)
        if weapon is not None:
            game._log("take", seat=use.source, target=target, zone=str(Zone.EQUIP), card=weapon.to_dict())
            yield from game.move_cards([weapon.id], Zone.HAND, use.source, reason="borrowed_sword")


class Nullify(CardDef):
    """Played in response: cancel a trick's effect on one target (a Nullify can be Nullified)."""

    name = "nullify"
    type = CardType.TRICK


# ---------------------------------------------------------------- delayed tricks


class DelayedTrick(CardDef):
    type = CardType.TRICK
    harmful = True

    def hits(self, judge_card: Card) -> bool:
        raise NotImplementedError

    def on_use(self, game, use):
        owner = use.targets[0] if use.targets else use.source
        yield from game.place_delayed(use.card, use.subcards, owner)

    def on_hit(self, game: Game, owner: Player, card: Card) -> Gen:
        yield from ()

    def on_miss(self, game: Game, owner: Player, card: Card) -> Gen:
        """Also used when the trick is nullified."""
        yield from ()

    def resolve_delayed(self, game: Game, owner: Player, card: Card) -> Gen:
        shown = dataclasses.replace(card, name=self.name)  # a converted card acts as this trick
        yield from game.move_cards([card.id], Zone.PROCESSING, reason="resolve_delayed")
        game._log("delayed", seat=owner.seat, card=shown.to_dict())
        if (yield from game.nullified(shown, None, owner.seat)):
            yield from self.on_miss(game, owner, card)
        else:
            j = yield from game.judge(owner.seat, self.name, self.hits)
            if j.hit:
                yield from self.on_hit(game, owner, card)
            else:
                yield from self.on_miss(game, owner, card)
        yield from game._flush_processing(card)


class Indulgence(DelayedTrick):
    """Judge: unless Hearts, the owner skips their play phase."""

    name = "indulgence"
    target_count = 1

    def can_use(self, game, user):
        return True

    def candidates(self, game, user):
        return [s for s in _others(game, user) if not game.has_in_judge(game.players[s], self.name)]

    def hits(self, judge_card):
        return judge_card.suit != Suit.HEART

    def on_hit(self, game, owner, card):
        owner.skip_phases.add(Phase.PLAY)
        yield from ()


class Lightning(DelayedTrick):
    """Placed on yourself. Judge: Spade 2-9 deals 3 thunder damage; otherwise it moves on."""

    name = "lightning"

    def can_use(self, game, user):
        return not game.has_in_judge(user, self.name)

    def auto_targets(self, game, user):
        return [user.seat]

    def hits(self, judge_card):
        return judge_card.suit == Suit.SPADE and 2 <= judge_card.rank <= 9

    def on_hit(self, game, owner, card):
        yield from game._flush_processing(card)
        yield from game.damage(None, owner.seat, 3, nature="thunder")

    def on_miss(self, game, owner, card):
        if card.name != self.name:
            game.judge_as[card.id] = self.name  # a converted Lightning stays one as it moves on
        for s in game.seats_from(owner.seat)[1:]:
            p = game.players[s]
            if p.alive and not game.has_in_judge(p, self.name):
                game._log("lightning_moves", seat=owner.seat, to=s)
                yield from game.move_cards([card.id], Zone.JUDGE, s, reason="lightning_moves")
                return
        yield from game.move_cards([card.id], Zone.JUDGE, owner.seat, reason="lightning_stays")


TRICK_DEFS: list[CardDef] = [
    ExNihilo(), Dismantle(), Snatch(), Duel(), Barbarians(), Arrows(),
    PeachGarden(), Harvest(), BorrowedSword(), Nullify(), Indulgence(), Lightning(),
]
