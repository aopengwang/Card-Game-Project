"""Starter hero roster: Three Kingdoms historical figures with ORIGINAL skills.

These are our own designs (not the official 三国杀 kits). Each skill's
docstring is its rules text and is sent to clients as-is.

Coverage of skill types: active, triggered, locked, conversion (ViewAs),
passive modifiers (range / distance / hand limit / targeting), limited,
awakening, lord.
"""
from __future__ import annotations

from engine import (
    ActiveSkill,
    CardType,
    ChooseCardRequest,
    ChooseOptionRequest,
    ChoosePlayerRequest,
    ConfirmRequest,
    Event,
    Hero,
    Kingdom,
    Phase,
    Skill,
    ViewAs,
    Zone,
)
from engine.model import Gen

W, S, U, Q = Kingdom.WEI, Kingdom.SHU, Kingdom.WU, Kingdom.QUN


# ---------------------------------------------------------------- helpers


def _my_phase(game, owner, event, data, phase: Phase) -> bool:
    return event == Event.PHASE_START and data == phase and game.current == owner.seat


def _others(game, owner) -> list[int]:
    return [s for s in game.seats_from(owner.seat)[1:] if game.players[s].alive]


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


# ================================================================= WEI


class IronEdict(ActiveSkill):
    """Once per turn: discard a hand card and choose another player. They must give you a
    hand card of their choice, or take 1 damage from you."""

    name = "iron_edict"
    min_cards = max_cards = 1
    min_targets = max_targets = 1

    def target_options(self, game, owner):
        return _others(game, owner)

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.discard(owner.seat, cards, reason=self.name)
        (t,) = targets
        tp = game.players[t]
        choices = ["give_card", "take_damage"] if tp.hand else ["take_damage"]
        pick = yield from game.ask(ChooseOptionRequest(seat=t, reason=self.name, about=owner.seat, choices=choices))
        if pick == "give_card":
            cid = yield from game.ask(
                ChooseCardRequest(seat=t, reason=self.name, about=t, options=[c.id for c in tp.hand])
            )
            yield from _give(game, t, owner.seat, cid, self.name)
        else:
            yield from game.damage(owner.seat, t, 1)


class NorthernLevy(Skill):
    """Lord, locked. Once per turn, when another Wei character takes damage, you draw 1 card."""

    name = "northern_levy"
    lord = locked = True
    per_turn = 1
    events = (Event.DAMAGED,)

    def can_trigger(self, game, owner, event, dmg):
        t = game.players[dmg.target]
        return t is not owner and t.kingdom == W and game.skill_ready(owner, self)

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        game.note_skill_used(owner, self)
        yield from game.draw(owner.seat, 1, reason=self.name)


class PatientScheme(Skill):
    """Locked. At the start of your end phase, if you used no cards this turn, draw 2 cards."""

    name = "patient_scheme"
    locked = True
    events = (Event.PHASE_START,)

    def can_trigger(self, game, owner, event, data):
        return _my_phase(game, owner, event, data, Phase.END) and not owner.turn_usage.get("_cards_used")

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.draw(owner.seat, 2, reason=self.name)


class SeizePower(ActiveSkill):
    """Once per turn: discard 2 hand cards to take 1 card from any other player's hand,
    equipment or judgment area (no distance limit)."""

    name = "seize_power"
    min_cards = max_cards = 2
    min_targets = max_targets = 1

    def target_options(self, game, owner):
        return [s for s in _others(game, owner) if game.players[s].all_cards()]

    def activate(self, game, owner, cards, targets) -> Gen:
        yield from game.discard(owner.seat, cards, reason=self.name)
        cid = yield from game.choose_card_from(owner.seat, targets[0], reason=self.name)
        if cid is not None:
            yield from _take(game, owner.seat, targets[0], cid, self.name)


SEIZE_POWER = SeizePower()


class WolfRises(Skill):
    """Awakening. At the start of your start phase, if your HP is 2 or less: lose 1 max HP,
    then gain "Seize Power"."""

    name = "wolf_rises"
    awakening = True
    events = (Event.PHASE_START,)

    def can_trigger(self, game, owner, event, data):
        return _my_phase(game, owner, event, data, Phase.START) and owner.hp <= 2

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.change_max_hp(owner.seat, -1)
        if owner.alive:
            game.add_skill(owner, SEIZE_POWER)


class FearlessVanguard(Skill):
    """Locked. Once per turn, during your turn, when your Strike deals damage to a player
    holding more hand cards than you, it deals +1 damage."""

    name = "fearless_vanguard"
    locked = True
    per_turn = 1
    events = (Event.DAMAGE_CAUSED,)

    def can_trigger(self, game, owner, event, dmg):
        return (
            dmg.source == owner.seat
            and game.current == owner.seat
            and dmg.card is not None
            and dmg.card.name == "strike"
            and len(game.players[dmg.target].hand) > len(owner.hand)
            and game.skill_ready(owner, self)
        )

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        game.note_skill_used(owner, self)
        dmg.amount += 1
        yield from ()


class SpoilsOfWar(Skill):
    """Locked. Whenever you take damage, put the physical card(s) that dealt it into your hand
    (all of them, if they were converted into one card). If there are none, draw 1 card."""

    name = "spoils_of_war"
    locked = True
    events = (Event.DAMAGED,)

    def can_trigger(self, game, owner, event, dmg):
        return dmg.target == owner.seat

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        loot = [i for i in game.physical_cards(dmg.card) if game.location[i][0] == Zone.PROCESSING]
        if not loot:
            yield from game.draw(owner.seat, 1, reason=self.name)
            return
        game._log("take", seat=owner.seat, target=None, zone=str(Zone.PROCESSING), reason=self.name,
                  cards=[game.cards[i].to_dict() for i in loot])
        yield from game.move_cards(loot, Zone.HAND, owner.seat, reason=self.name)


class ShieldWall(Skill):
    """Lord. Whenever you need to play a Dodge, you may ask the other Wei characters, in seat
    order, to play one for you (their armor may help them do it)."""

    name = "shield_wall"
    lord = True
    assists = frozenset({"dodge"})

    def assist(self, game, owner, card_name, reason, about) -> Gen:
        helpers = [s for s in _others(game, owner) if game.players[s].kingdom == W]
        if not helpers:
            return None
        if not (yield from game.ask(ConfirmRequest(seat=owner.seat, reason=self.name, about=about))):
            return None
        for h in helpers:
            card = yield from game.respond(h, "dodge", reason=self.name, about=owner.seat)
            if card is not None:
                return game.make_virtual("dodge", [])
        return None


# ================================================================= SHU


class GatherTheRighteous(ActiveSkill):
    """Once per turn: give a hand card to a player who has fewer hand cards than you;
    then you both draw 1 card."""

    name = "gather_the_righteous"
    harmful = False
    min_cards = max_cards = 1
    min_targets = max_targets = 1

    def target_options(self, game, owner):
        return [s for s in _others(game, owner) if len(game.players[s].hand) < len(owner.hand)]

    def activate(self, game, owner, cards, targets) -> Gen:
        (t,) = targets
        yield from _give(game, owner.seat, t, cards[0], self.name)
        yield from game.draw(owner.seat, 1, reason=self.name)
        yield from game.draw(t, 1, reason=self.name)


class HeirOfHan(Skill):
    """Lord, locked. Your hand limit is +1 for each other living Shu character."""

    name = "heir_of_han"
    lord = locked = True

    def hand_limit_bonus(self, game, owner):
        return sum(1 for p in game.alive_players() if p is not owner and p.kingdom == S)


class SteadfastBlade(Skill):
    """Locked. Whenever a Strike you use is dodged, draw 1 card."""

    name = "steadfast_blade"
    locked = True
    events = (Event.STRIKE_DODGED,)

    def can_trigger(self, game, owner, event, data):
        use, _ = data
        return use.source == owner.seat

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.draw(owner.seat, 1, reason=self.name)


class EastWind(ActiveSkill):
    """Limited (once per game). Deal 1 fire damage to each of up to 2 other players."""

    name = "east_wind"
    limited = True
    min_targets = 1
    max_targets = 2

    def target_options(self, game, owner):
        return _others(game, owner)

    def activate(self, game, owner, cards, targets) -> Gen:
        for t in game.seats_from(owner.seat):
            if t in targets:
                yield from game.damage(owner.seat, t, 1, nature="fire")


class Strategist(Skill):
    """Locked. Whenever another player's trick card targets you, draw 1 card."""

    name = "strategist"
    locked = True
    events = (Event.TARGET_CONFIRMED,)

    def can_trigger(self, game, owner, event, data):
        use, target = data
        return target == owner.seat and use.source != owner.seat and game.card_def(use.card).type == CardType.TRICK

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.draw(owner.seat, 1, reason=self.name)


# ================================================================= WU


class SteadyHand(Skill):
    """Locked. At the start of your end phase, if you took no damage this turn, draw 1 card."""

    name = "steady_hand"
    locked = True
    events = (Event.PHASE_START,)

    def can_trigger(self, game, owner, event, data):
        return _my_phase(game, owner, event, data, Phase.END) and not owner.turn_usage.get("_damage_taken")

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.draw(owner.seat, 1, reason=self.name)


class WuAscendant(Skill):
    """Lord, locked. Whenever another Wu character recovers HP, you draw 1 card."""

    name = "wu_ascendant"
    lord = locked = True
    events = (Event.RECOVERED,)

    def can_trigger(self, game, owner, event, data):
        seat, _ = data
        return seat != owner.seat and game.players[seat].kingdom == U

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.draw(owner.seat, 1, reason=self.name)


class BurningFleet(ViewAs):
    """Once per turn, during your play phase: you may use 2 hand cards of the same suit as
    an Arrow Barrage."""

    name = "burning_fleet"
    as_name = "arrows"
    count = 2
    per_turn = 1
    in_response = False

    def check(self, game, owner, cards):
        if len({game.cards[c].suit for c in cards}) != 1:
            return "burning_fleet needs 2 cards of the same suit"
        return None


class Composure(Skill):
    """Locked. Your hand limit is +1."""

    name = "composure"
    locked = True

    def hand_limit_bonus(self, game, owner):
        return 1


class Humble(Skill):
    """Locked. You cannot be the target of Duel or Borrowed Sword."""

    name = "humble"
    locked = True

    def can_be_targeted(self, game, owner, card_name, user):
        return card_name not in ("duel", "borrowed_sword")


class Endurance(Skill):
    """Locked. Whenever you take damage, draw 1 card for each point of damage."""

    name = "endurance"
    locked = True
    events = (Event.DAMAGED,)

    def can_trigger(self, game, owner, event, dmg):
        return dmg.target == owner.seat

    def on_trigger(self, game, owner, event, dmg) -> Gen:
        yield from game.draw(owner.seat, dmg.amount, reason=self.name)


# ================================================================= QUN


class SkyPiercer(Skill):
    """Locked. Your attack range is +1. Whenever you kill a player, recover 1 HP."""

    name = "sky_piercer"
    locked = True
    events = (Event.DEATH,)

    def attack_range_bonus(self, game, owner):
        return 1

    def can_trigger(self, game, owner, event, data):
        _, cause = data
        return cause is not None and cause.source == owner.seat and owner.is_wounded

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.recover(owner.seat, 1, source=owner.seat)


class Allure(ActiveSkill):
    """Once per turn: give a hand card to a male character, then choose another player in
    their attack range. They must use a Strike on that player, or you take 1 of their cards."""

    name = "allure"
    min_cards = max_cards = 1
    min_targets = max_targets = 1

    def target_options(self, game, owner):
        return [s for s in _others(game, owner) if game.players[s].gender == "male"]

    def activate(self, game, owner, cards, targets) -> Gen:
        (t,) = targets
        yield from _give(game, owner.seat, t, cards[0], self.name)
        victims = [p.seat for p in game.alive_players() if game.in_attack_range(t, p.seat)]
        if victims and game.players[t].alive:
            victim = yield from game.ask(ChoosePlayerRequest(seat=owner.seat, reason=self.name, about=t, options=victims))
            game._log("allure", seat=owner.seat, target=t, victim=victim)
            used = yield from game.use_strike(t, victim, reason=self.name, context={"source": owner.seat})
            if used is not None:
                return
        if game.players[t].alive and owner.alive:
            cid = yield from game.choose_card_from(owner.seat, t, reason=self.name, include_judge=False)
            if cid is not None:
                yield from _take(game, owner.seat, t, cid, self.name)


class MoonlitRest(Skill):
    """Locked. At the start of your end phase, if you have fewer hand cards than your HP, draw 1 card."""

    name = "moonlit_rest"
    locked = True
    events = (Event.PHASE_START,)

    def can_trigger(self, game, owner, event, data):
        return _my_phase(game, owner, event, data, Phase.END) and len(owner.hand) < owner.hp

    def on_trigger(self, game, owner, event, data) -> Gen:
        yield from game.draw(owner.seat, 1, reason=self.name)


class FiveAnimals(Skill):
    """Locked. At the start of your start phase, if you are wounded, judge: red, recover 1 HP;
    black, draw 1 card."""

    name = "five_animals"
    locked = True
    events = (Event.PHASE_START,)

    def can_trigger(self, game, owner, event, data):
        return _my_phase(game, owner, event, data, Phase.START) and owner.is_wounded

    def on_trigger(self, game, owner, event, data) -> Gen:
        j = yield from game.judge(owner.seat, self.name, lambda c: c.is_red)
        if j.hit:
            yield from game.recover(owner.seat, 1, source=owner.seat)
        else:
            yield from game.draw(owner.seat, 1, reason=self.name)


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


# ================================================================= roster


HEROES: list[Hero] = [
    Hero("cao_cao", "Cao Cao", W, 4, "male", (IronEdict(), NorthernLevy())),
    Hero("wei_lie", "Wei Lie", W, 4, "male", (SpoilsOfWar(), ShieldWall())),
    Hero("sima_yi", "Sima Yi", W, 3, "male", (PatientScheme(), WolfRises())),
    Hero("zhang_liao", "Zhang Liao", W, 4, "male", (FearlessVanguard(),)),
    Hero("liu_bei", "Liu Bei", S, 4, "male", (GatherTheRighteous(), HeirOfHan())),
    Hero("guan_yu", "Guan Yu", S, 4, "male", (SteadfastBlade(),)),
    Hero("zhuge_liang", "Zhuge Liang", S, 3, "male", (EastWind(), Strategist())),
    Hero("sun_quan", "Sun Quan", U, 4, "male", (SteadyHand(), WuAscendant())),
    Hero("zhou_yu", "Zhou Yu", U, 3, "male", (BurningFleet(), Composure())),
    Hero("lu_xun", "Lu Xun", U, 3, "male", (Humble(), Endurance())),
    Hero("lu_bu", "Lü Bu", Q, 4, "male", (SkyPiercer(),)),
    Hero("diaochan", "Diaochan", Q, 3, "female", (Allure(), MoonlitRest())),
    Hero("hua_tuo", "Hua Tuo", Q, 3, "male", (FiveAnimals(),)),
    Hero("yu_ji", "Yu Ji", Q, 3, "male", (Omen(), Hermit())),
]

HERO_MAP: dict[str, Hero] = {h.id: h for h in HEROES}

# Skills a hero can gain during play (not on any starting kit), listed for clients.
GAINED_SKILLS = [SEIZE_POWER]
