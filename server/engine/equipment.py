"""Base class for equipment cards. Content subclasses set the static modifiers
(range, horses...) and optionally attach a Skill / ViewAs / response assist."""
from __future__ import annotations

from typing import TYPE_CHECKING

from .events import Skill, ViewAs
from .model import CardDef, CardType, CardUse, EquipSlot, Gen, Zone

if TYPE_CHECKING:
    from .game import Game, Player


class EquipDef(CardDef):
    type = CardType.EQUIPMENT
    slot: EquipSlot = EquipSlot.WEAPON

    attack_range: int | None = None  # weapons only
    distance_in: int = 0  # added to everyone else's distance to the owner (+1 horse)
    distance_out: int = 0  # added to the owner's distance to everyone else (-1 horse)
    unlimited_strikes: bool = False
    ignores_armor: bool = False  # the owner's Strikes ignore the target's armor

    skill: Skill | None = None  # triggered effect while equipped
    view_as: ViewAs | None = None  # conversion granted while equipped
    assists: frozenset[str] = frozenset()  # card names `assist` can provide when asked

    def can_use(self, game: Game, user: Player) -> bool:
        return True

    def on_use(self, game: Game, use: CardUse) -> Gen:
        owner = game.players[use.source]
        old = game.equip_in(owner, self.slot)
        if old is not None:
            yield from game.discard(owner.seat, [old.id], reason="replace_equip")
        game._log("equip", seat=owner.seat, card=use.card.to_dict(), slot=str(self.slot))
        yield from game.move_cards([use.card.id], Zone.EQUIP, owner.seat, reason="equip")

    def extra_targets(self, game: Game, user: Player, card_name: str, whole_hand: bool) -> int:
        """Extra targets the owner may add when using `card_name` (whole_hand: it spends
        every card in their hand)."""
        return 0

    def assist(self, game: Game, owner: Player, card_name: str, reason: str, about: int | None) -> Gen:
        """Offer to provide `card_name` (one of `assists`) without a real card.
        Return a (virtual) Card, or None to fall through to asking for a real one."""
        return None
        yield  # pragma: no cover  (makes this a generator)
