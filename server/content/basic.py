"""Basic cards: Strike (incl. Fire / Thunder Strikes: Strikes with a damage nature), Dodge,
Peach, Wine."""
from __future__ import annotations

from engine import CardDef, CardType, CardUse, Event, Game, Player
from engine.model import Gen


class Strike(CardDef):
    """Once per turn: target a player in your attack range. They must play a Dodge or take 1 damage."""

    name = "strike"
    type = CardType.BASIC
    target_count = 1

    def can_use(self, game: Game, user: Player) -> bool:
        return user.strikes_used < game.strike_limit(user)

    def candidates(self, game: Game, user: Player) -> list[int]:
        reach = game.attack_range(user)
        return [
            p.seat
            for p in game.alive_players()
            if p.seat != user.seat and game.distance(user.seat, p.seat) <= reach
        ]

    def on_use(self, game: Game, use: CardUse) -> Gen:
        user = game.players[use.source]
        if not use.data.get("free"):  # extra strikes (borrowed sword, glaive) don't count
            user.strikes_used += 1
        if user.turn_usage.pop("_drunk", None):  # a Wine earlier this turn
            use.damage_bonus += 1
        for target in list(use.targets):
            if not game.players[target].alive:
                continue
            target = yield from game.become_target(use, target)  # may be handed on
            yield from game.trigger(Event.TARGET_CONFIRMED, (use, target))
            if target in use.cancelled:
                continue
            if target not in use.data.get("undodgeable", ()) and (yield from self._dodged(game, use, target)):
                yield from game.trigger(Event.STRIKE_DODGED, (use, target))
                if target not in use.data.get("forced", ()):
                    continue
            yield from game.damage(use.source, target, 1 + use.damage_bonus, card=use.card, nature=use.card.nature)

    @staticmethod
    def _dodged(game: Game, use: CardUse, target: int) -> Gen:
        """Ask for the Dodge(s): two in a row against a Strike from someone who demands double."""
        need = 2 if game.doubled(use.source) else 1
        for i in range(need):
            dodge = yield from game.respond(
                target, "dodge", reason="strike", about=use.source, use=use,
                context={"need": need, "got": i} if need > 1 else None,
            )
            if dodge is None:
                return False
        return True


class Dodge(CardDef):
    """Played in response to cancel a Strike (or an Arrow Barrage hit)."""

    name = "dodge"
    type = CardType.BASIC


class Peach(CardDef):
    """On your turn, recover 1 HP if wounded. Also played to save a dying player."""

    name = "peach"
    type = CardType.BASIC

    def can_use(self, game: Game, user: Player) -> bool:
        return user.is_wounded

    def on_use(self, game: Game, use: CardUse) -> Gen:
        yield from game.recover(use.source, 1, source=use.source)


class Wine(CardDef):
    """Once per turn: your next Strike this turn deals +1 damage. When you are dying, you may
    play it to recover 1 HP."""

    name = "wine"
    type = CardType.BASIC

    def can_use(self, game: Game, user: Player) -> bool:
        return not user.turn_usage.get("_wine")

    def on_use(self, game: Game, use: CardUse) -> Gen:
        usage = game.players[use.source].turn_usage
        usage["_wine"] = usage["_drunk"] = 1
        yield from ()


BASIC_DEFS: list[CardDef] = [Strike(), Dodge(), Peach(), Wine()]
