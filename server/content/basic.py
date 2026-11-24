"""Basic cards: Strike, Dodge, Peach."""
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
        if not use.data.get("free"):  # extra strikes (borrowed sword, glaive) don't count
            game.players[use.source].strikes_used += 1
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
            yield from game.damage(use.source, target, 1 + use.damage_bonus, card=use.card)

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


BASIC_DEFS: list[CardDef] = [Strike(), Dodge(), Peach()]
