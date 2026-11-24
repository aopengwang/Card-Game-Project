"""The standard ruleset: 104 standard cards + 4 "EX" cards = 108.

53 basic, 31 instant tricks, 5 delayed tricks, 19 equipment.
"""
from __future__ import annotations

from typing import Collection

from engine import Card, CardDef, Game, Role, Ruleset, Suit

from .basic import BASIC_DEFS
from .equipment import EQUIPMENT_DEFS
from .heroes import HERO_MAP
from .tricks import TRICK_DEFS

S, H, C, D = Suit.SPADE, Suit.HEART, Suit.CLUB, Suit.DIAMOND
A, J, Q, K = 1, 11, 12, 13

# (card name, suit, ranks)
DECK_SPEC: list[tuple[str, Suit, list[int]]] = [
    # basic (53)
    ("strike", S, [7, 8, 8, 9, 9, 10, 10]),
    ("strike", C, [2, 3, 4, 5, 6, 7, 8, 8, 9, 9, 10, 10, J, J]),
    ("strike", H, [10, 10, J]),
    ("strike", D, [6, 7, 8, 9, 10, K]),
    ("dodge", H, [2, 2, K]),
    ("dodge", D, [2, 2, 3, 4, 5, 6, 7, 8, 9, 10, J, J]),
    ("peach", H, [3, 4, 6, 7, 8, 9, Q]),
    ("peach", D, [Q]),
    # instant tricks (31)
    ("ex_nihilo", H, [7, 8, 9, J]),
    ("dismantle", S, [3, 4, Q]),
    ("dismantle", C, [3, 4]),
    ("dismantle", H, [Q]),
    ("snatch", S, [3, 4, J]),
    ("snatch", D, [3, 4]),
    ("duel", S, [A]),
    ("duel", C, [A]),
    ("duel", D, [A]),
    ("barbarians", S, [7, K]),
    ("barbarians", C, [7]),
    ("arrows", H, [A]),
    ("peach_garden", H, [A]),
    ("harvest", H, [3, 4]),
    ("borrowed_sword", C, [Q, K]),
    ("nullify", S, [J]),
    ("nullify", C, [Q, K]),
    ("nullify", D, [Q]),  # EX
    # delayed tricks (5)
    ("indulgence", S, [6]),
    ("indulgence", C, [6]),
    ("indulgence", H, [6]),
    ("lightning", S, [A]),
    ("lightning", H, [Q]),  # EX
    # weapons (10)
    ("crossbow", C, [A]),
    ("crossbow", D, [A]),
    ("piercing_sword", S, [6]),
    ("twin_swords", S, [2]),
    ("frost_blade", S, [2]),  # EX
    ("dragon_glaive", S, [5]),
    ("stone_axe", D, [5]),
    ("serpent_spear", S, [Q]),
    ("halberd", D, [Q]),
    ("kirin_bow", H, [5]),
    # armor (3)
    ("eight_trigrams", S, [2]),
    ("eight_trigrams", C, [2]),
    ("benevolent_shield", C, [2]),  # EX
    # horses (6)
    ("plus_horse", S, [5]),
    ("plus_horse", C, [5]),
    ("plus_horse", H, [K]),
    ("minus_horse", H, [5]),
    ("minus_horse", S, [K]),
    ("minus_horse", D, [K]),
]

CARD_DEFS: dict[str, CardDef] = {d.name: d for d in (*BASIC_DEFS, *TRICK_DEFS, *EQUIPMENT_DEFS)}


def build_deck() -> list[Card]:
    cards: list[Card] = []
    for name, suit, ranks in DECK_SPEC:
        for rank in ranks:
            cards.append(Card(id=len(cards), name=name, suit=suit, rank=rank))
    return cards


STANDARD = Ruleset(name="standard", card_defs=CARD_DEFS, build_deck=build_deck, heroes=HERO_MAP)


def new_game(
    num_players: int,
    seed: int,
    roles: list[Role] | None = None,
    heroes: list[str] | None = None,
    draft: bool = False,
    hero_pool: Collection[str] | None = None,
) -> Game:
    """`draft=True` for real games (players pick heroes, from `hero_pool` if given);
    `heroes` fixes them by seat (tests); neither gives skill-less 4 HP heroes."""
    return Game(STANDARD, num_players, seed, roles, heroes=heroes, draft=draft, hero_pool=hero_pool)
