from collections import Counter

import pytest

from content.standard import new_game
from engine import ROLE_TABLE, PlayRequest, Role
from engine.view import log_for, view_for

from .helpers import assert_cards_conserved


@pytest.mark.parametrize("n", [4, 5, 6, 7, 8])
def test_role_distribution(n):
    g = new_game(n, seed=n)
    assert Counter(p.role for p in g.players) == Counter(ROLE_TABLE[n])
    assert g.current == g.lord_seat


@pytest.mark.parametrize("n,lord_hp", [(4, 4), (5, 5), (6, 5)])
def test_lord_bonus_hp(n, lord_hp):
    g = new_game(n, seed=0)
    lord = g.players[g.lord_seat]
    assert lord.max_hp == lord.hp == lord_hp
    assert all(p.hp == 4 for p in g.players if p.role != Role.LORD)


def test_first_request_is_lords_play_phase():
    g = new_game(5, seed=3)
    req = next(g.run())
    assert isinstance(req, PlayRequest) and req.seat == g.lord_seat
    for p in g.players:
        assert len(p.hand) == (6 if p.seat == g.lord_seat else 4)
    assert len(g.draw_pile) == len(g.cards) - 4 * 5 - 2
    assert_cards_conserved(g)


def test_view_hides_private_information():
    g = new_game(5, seed=3)
    next(g.run())
    viewer = next(p.seat for p in g.players if p.role != Role.LORD)
    v = view_for(g, viewer)
    assert len(v["hand"]) == 4
    for p in v["players"]:
        if p["seat"] == viewer or p["seat"] == g.lord_seat:
            assert p["role"] is not None
        else:
            assert p["role"] is None
        assert "hand" not in p
    for e in log_for(g, viewer):
        if e["type"] == "draw":
            assert ("cards" in e) == (e["seat"] == viewer)
            assert "private" not in e
