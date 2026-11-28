from __future__ import annotations

from typing import Any

from content.standard import new_game
from engine import Game, Request, Role, Zone

L, Y, R, S = Role.LORD, Role.LOYALIST, Role.REBEL, Role.SPY


def level_lord(game: Game) -> Game:
    """Drop the Lord's extra HP at tables of fewer than 5, so rule tests can count from the
    printed HP (the bonus itself is tested in test_setup)."""
    if len(game.players) < 5:
        lord = game.players[game.lord_seat]
        lord.max_hp -= 1
        lord.hp = lord.max_hp
    return game


def game4(*roles: Role, seed: int = 0) -> Game:
    roles = roles or (L, Y, R, S)
    return level_lord(new_game(len(roles), seed, list(roles)))


def give(game: Game, seat: int, *names: str) -> list[int]:
    """Rig a hand: move cards with these names from the draw pile into `seat`'s hand."""
    ids = []
    for name in names:
        card = next(c for c in game.draw_pile if c.name == name)
        game._raw_move(card.id, Zone.HAND, seat)
        ids.append(card.id)
    return ids


def give_where(game: Game, seat: int, pred) -> int:
    """Move the first draw-pile card matching `pred` into `seat`'s hand."""
    card = next(c for c in game.draw_pile if pred(c))
    game._raw_move(card.id, Zone.HAND, seat)
    return card.id


def equip(game: Game, seat: int, name: str) -> int:
    """Rig equipment: put a `name` card from the draw pile straight into `seat`'s equip area."""
    card = next(c for c in game.draw_pile if c.name == name)
    game._raw_move(card.id, Zone.EQUIP, seat)
    return card.id


def stack_top(game: Game, pred) -> int:
    """Put the first draw-pile card matching `pred` on top (next to be drawn / judged)."""
    card = next(c for c in game.draw_pile if pred(c))
    game.draw_pile.remove(card)
    game.draw_pile.append(card)
    return card.id


def pass_all(req: Request) -> Any:
    return req.default()


def assert_cards_conserved(game: Game) -> None:
    zones = [game.draw_pile, game.discard_pile, game.processing]
    for p in game.players:
        zones += [p.hand, p.equips, p.judge]
    seen = [c.id for z in zones for c in z]
    assert sorted(seen) == sorted(game.cards), "cards lost or duplicated"
    for z, owner_zone in [(game.draw_pile, Zone.DRAW_PILE), (game.discard_pile, Zone.DISCARD_PILE)]:
        assert all(game.location[c.id][0] == owner_zone for c in z)
    for p in game.players:
        assert all(game.location[c.id] == (Zone.HAND, p.seat) for c in p.hand)
        assert all(game.location[c.id] == (Zone.EQUIP, p.seat) for c in p.equips)
