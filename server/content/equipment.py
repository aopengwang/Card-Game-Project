"""Equipment cards: weapons (attack range + an ability), armor, and horses.

Each weapon/armor's ability is a Skill (or ViewAs / assist) that is only
active while the card sits in its owner's equipment area.
"""
from __future__ import annotations

from engine import (
    ConfirmRequest,
    ChooseCardRequest,
    ChooseOptionRequest,
    DiscardRequest,
    EquipDef,
    EquipSlot,
    Event,
    Skill,
    ViewAs,
)
from engine.model import Gen


def _is_strike(card) -> bool:
    return card is not None and card.name == "strike"


def _horses(game, p) -> list[int]:
    return [c.id for c, d in game.equip_defs(p) if d.slot in (EquipSlot.PLUS_HORSE, EquipSlot.MINUS_HORSE)]


# ---------------------------------------------------------------- weapons


class Weapon(EquipDef):
    slot = EquipSlot.WEAPON


class Crossbow(Weapon):
    """Range 1. No limit on Strikes per turn."""

    name = "crossbow"
    attack_range = 1
    unlimited_strikes = True


class PiercingSword(Weapon):
    """Range 2. Your Strikes ignore the target's armor."""

    name = "piercing_sword"
    attack_range = 2
    ignores_armor = True


class _TwinSwordsSkill(Skill):
    name = "twin_swords"
    events = (Event.TARGET_CONFIRMED,)

    def can_trigger(self, game, owner, event, data):
        use, target = data
        return (
            use.source == owner.seat
            and _is_strike(use.card)
            and game.players[target].gender != owner.gender
        )

    def on_trigger(self, game, owner, event, data) -> Gen:
        use, target = data
        if not (yield from game.ask(ConfirmRequest(seat=owner.seat, reason=self.name, about=target))):
            return
        t = game.players[target]
        choices = ["let_draw", "discard"] if t.hand else ["let_draw"]
        pick = yield from game.ask(ChooseOptionRequest(seat=target, reason=self.name, about=owner.seat, choices=choices))
        if pick == "discard":
            ids = yield from game.ask(
                DiscardRequest(seat=target, count=1, options=[c.id for c in t.hand], reason=self.name)
            )
            yield from game.discard(target, list(ids), reason=self.name)
        else:
            yield from game.draw(owner.seat, 1, reason=self.name)


class TwinSwords(Weapon):
    """Range 2. When your Strike targets someone of the other gender, you may make them
    choose: discard a hand card, or let you draw 1."""

    name = "twin_swords"
    attack_range = 2
    skill = _TwinSwordsSkill()


class _FrostBladeSkill(Skill):
    name = "frost_blade"
    events = (Event.DAMAGE_CAUSED,)

    def can_trigger(self, game, owner, event, dmg):
        t = game.players[dmg.target]
        return dmg.source == owner.seat and _is_strike(dmg.card) and bool(t.hand or t.equips)

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        if not (yield from game.ask(ConfirmRequest(seat=owner.seat, reason=self.name, about=dmg.target))):
            return
        dmg.prevented = True
        game._log("prevented", seat=owner.seat, target=dmg.target, reason=self.name)
        for _ in range(2):
            cid = yield from game.choose_card_from(owner.seat, dmg.target, reason=self.name, include_judge=False)
            if cid is None:
                return
            yield from game.discard(dmg.target, [cid], reason=self.name)


class FrostBlade(Weapon):
    """Range 2. When your Strike would deal damage, you may prevent it and instead
    discard 2 of the target's cards (hand or equipment)."""

    name = "frost_blade"
    attack_range = 2
    skill = _FrostBladeSkill()


class _DragonGlaiveSkill(Skill):
    name = "dragon_glaive"
    events = (Event.STRIKE_DODGED,)

    def can_trigger(self, game, owner, event, data):
        use, target = data
        return use.source == owner.seat and game.players[target].alive

    def on_trigger(self, game, owner, event, data) -> Gen:
        _, target = data
        yield from game.use_strike(owner.seat, target, reason=self.name)


class DragonGlaive(Weapon):
    """Range 3. When your Strike is dodged, you may immediately use another Strike on that target."""

    name = "dragon_glaive"
    attack_range = 3
    skill = _DragonGlaiveSkill()


class _StoneAxeSkill(Skill):
    name = "stone_axe"
    events = (Event.STRIKE_DODGED,)

    @staticmethod
    def payable(game, owner) -> list[int]:
        return [c.id for c in [*owner.hand, *owner.equips] if c.name != "stone_axe"]

    def can_trigger(self, game, owner, event, data):
        use, target = data
        return use.source == owner.seat and len(self.payable(game, owner)) >= 2

    def on_trigger(self, game, owner, event, data) -> Gen:
        use, target = data
        if not (yield from game.ask(ConfirmRequest(seat=owner.seat, reason=self.name, about=target))):
            return
        ids = yield from game.ask(
            DiscardRequest(seat=owner.seat, count=2, options=self.payable(game, owner), reason=self.name)
        )
        yield from game.discard(owner.seat, list(ids), reason=self.name)
        use.data.setdefault("forced", set()).add(target)


class StoneAxe(Weapon):
    """Range 3. When your Strike is dodged, you may discard 2 cards (not this one) to hit anyway."""

    name = "stone_axe"
    attack_range = 3
    skill = _StoneAxeSkill()


class _SerpentSpearViewAs(ViewAs):
    name = "serpent_spear"
    as_name = "strike"
    count = 2


class SerpentSpear(Weapon):
    """Range 3. You may use or play any 2 hand cards as a Strike."""

    name = "serpent_spear"
    attack_range = 3
    view_as = _SerpentSpearViewAs()


class Halberd(Weapon):
    """Range 4. If a Strike is the last card(s) in your hand, it may target up to 2 more players."""

    name = "halberd"
    attack_range = 4

    def extra_targets(self, game, user, card_name, whole_hand):
        return 2 if card_name == "strike" and whole_hand else 0


class _KirinBowSkill(Skill):
    name = "kirin_bow"
    events = (Event.DAMAGE_CAUSED,)

    def can_trigger(self, game, owner, event, dmg):
        return dmg.source == owner.seat and _is_strike(dmg.card) and bool(_horses(game, game.players[dmg.target]))

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        cid = yield from game.ask(
            ChooseCardRequest(
                seat=owner.seat,
                reason=self.name,
                about=dmg.target,
                options=_horses(game, game.players[dmg.target]),
                optional=True,
            )
        )
        if cid is not None:
            yield from game.discard(dmg.target, [cid], reason=self.name)


class KirinBow(Weapon):
    """Range 5. When your Strike deals damage, you may discard one of the target's horses."""

    name = "kirin_bow"
    attack_range = 5
    skill = _KirinBowSkill()


# ---------------------------------------------------------------- armor


class EightTrigrams(EquipDef):
    """When you need to play a Dodge, you may judge: if red, it counts as playing a Dodge."""

    name = "eight_trigrams"
    slot = EquipSlot.ARMOR
    assists = frozenset({"dodge"})

    def assist(self, game, owner, card_name, reason, about) -> Gen:
        if not (yield from game.ask(ConfirmRequest(seat=owner.seat, reason=self.name, about=about))):
            return None
        j = yield from game.judge(owner.seat, self.name, lambda c: c.is_red)
        return game.make_virtual("dodge", []) if j.hit else None


class _BenevolentShieldSkill(Skill):
    name = "benevolent_shield"
    events = (Event.TARGET_CONFIRMED,)

    def can_trigger(self, game, owner, event, data):
        use, target = data
        return (
            target == owner.seat
            and _is_strike(use.card)
            and use.card.is_black
            and game.armor_active(owner.seat, use)
        )

    def on_trigger(self, game, owner, event, data) -> Gen:
        use, target = data
        use.cancelled.add(target)
        game._log("blocked", seat=target, card=use.card.to_dict(), reason=self.name)
        yield from ()


class BenevolentShield(EquipDef):
    """Black Strikes have no effect on you."""

    name = "benevolent_shield"
    slot = EquipSlot.ARMOR
    skill = _BenevolentShieldSkill()


# ---------------------------------------------------------------- horses


class PlusHorse(EquipDef):
    """Other players' distance to you is +1."""

    name = "plus_horse"
    slot = EquipSlot.PLUS_HORSE
    distance_in = 1


class MinusHorse(EquipDef):
    """Your distance to other players is -1."""

    name = "minus_horse"
    slot = EquipSlot.MINUS_HORSE
    distance_out = -1


EQUIPMENT_DEFS: list[EquipDef] = [
    Crossbow(), PiercingSword(), TwinSwords(), FrostBlade(), DragonGlaive(), StoneAxe(),
    SerpentSpear(), Halberd(), KirinBow(), EightTrigrams(), BenevolentShield(), PlusHorse(), MinusHorse(),
]
