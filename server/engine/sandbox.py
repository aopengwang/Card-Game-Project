"""Test-room powers: change the table directly to try out heroes and skills.

These change state silently (no events fire, no skill reacts), the way a referee would
rearrange the table between plays. Each logs a public "sandbox" entry so everyone can
see what changed. Errors are ValueError with a message meant for the player.
"""
from __future__ import annotations

from .game import Game
from .model import Card, Suit, Zone

ACTIONS = ("hero", "card", "top", "hp")


def _player(game: Game, seat: object):
    if not isinstance(seat, int) or isinstance(seat, bool) or not 0 <= seat < len(game.players):
        raise ValueError("no such seat")
    p = game.players[seat]
    if not p.alive:
        raise ValueError("that player is dead")
    return p


def _free_card(game: Game, name: object, suit: object) -> Card:
    """A card called `name` (of `suit`, if given) from the draw pile, else the discard pile."""
    if suit not in (None, "", "any") and suit not in {str(s) for s in Suit if s != Suit.NONE}:
        raise ValueError("unknown suit")
    want_suit = None if suit in (None, "", "any") else suit
    if not isinstance(name, str) or name not in game.ruleset.card_defs:
        raise ValueError("unknown card")
    for pile in (game.draw_pile, game.discard_pile):
        for card in reversed(pile):
            if card.name == name and (want_suit is None or str(card.suit) == want_suit):
                return card
    if not any(c.name == name for c in game.cards.values()):
        raise ValueError("that card isn't in this deck (turn on the Battle expansion)")
    raise ValueError("no such card left in the draw or discard pile")


def set_hero(game: Game, seat: object, hero: object) -> None:
    """Become another hero: new skills, HP reset to the new maximum; cards stay."""
    p = _player(game, seat)
    if not isinstance(hero, str) or hero not in game.ruleset.heroes:
        raise ValueError("unknown hero")
    game.assign_hero(p.seat, hero)
    p.marks.clear()  # limited skills used, awakenings...: a fresh hero
    p.turn_usage.clear()
    game._log("sandbox", action="hero", seat=p.seat, hero=hero)


def give_card(game: Game, seat: object, name: object, suit: object = None) -> Card:
    """Put a card into a player's hand."""
    p = _player(game, seat)
    card = _free_card(game, name, suit)
    game._raw_move(card.id, Zone.HAND, p.seat)
    game._log("sandbox", action="card", seat=p.seat, card=card.to_dict())
    return card


def stack_card(game: Game, name: object, suit: object = None) -> Card:
    """Put a card on top of the draw pile (the next draw or judgment)."""
    card = _free_card(game, name, suit)
    game._raw_move(card.id, Zone.DRAW_PILE)  # appended: the top of the pile
    game._log("sandbox", action="top", card=card.to_dict())
    return card


def set_hp(game: Game, seat: object, hp: object) -> None:
    p = _player(game, seat)
    if not isinstance(hp, int) or isinstance(hp, bool) or not 1 <= hp <= p.max_hp:
        raise ValueError(f"HP must be between 1 and {p.max_hp}")
    p.hp = hp
    game._log("sandbox", action="hp", seat=p.seat, hp=hp)


def apply(game: Game, msg: dict) -> None:
    """Run one test-room action from a client message."""
    action = msg.get("action")
    if action == "hero":
        set_hero(game, msg.get("seat"), msg.get("hero"))
    elif action == "card":
        give_card(game, msg.get("seat"), msg.get("name"), msg.get("suit"))
    elif action == "top":
        stack_card(game, msg.get("name"), msg.get("suit"))
    elif action == "hp":
        set_hp(game, msg.get("seat"), msg.get("hp"))
    else:
        raise ValueError("unknown test-room action")
