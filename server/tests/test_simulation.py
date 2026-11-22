"""Many full bot games: the engine must always terminate with a consistent result."""
import pytest

from bots import SimpleBot
from content.standard import new_game
from engine import Role
from engine.driver import play_game

from .helpers import assert_cards_conserved

TEAMS = {
    "lord": {Role.LORD, Role.LOYALIST},
    "rebel": {Role.REBEL},
    "spy": {Role.SPY},
}


def bot_game(n, seed, draft=True):
    g = new_game(n, seed, draft=draft)
    result = play_game(g, [SimpleBot(seed * 100 + i) for i in range(n)])
    return g, result


@pytest.mark.parametrize("n", [4, 5, 6, 8])
@pytest.mark.parametrize("seed", range(60))
def test_bot_games_finish_consistently(n, seed):
    g, result = bot_game(n, seed, draft=seed % 4 != 0)  # mostly with heroes, some blank
    assert result is g.result
    assert_cards_conserved(g)
    assert g.log[-1]["type"] == "game_over"
    if result.side == "draw":
        return
    assert result.winners
    assert all(g.players[s].role in TEAMS[result.side] for s in result.winners)
    if result.side == "spy":
        assert [p.seat for p in g.alive_players()] == result.winners
    if result.side == "rebel":
        assert not g.players[g.lord_seat].alive
    if result.side == "lord":
        assert all(p.role in TEAMS["lord"] for p in g.alive_players())
    for p in g.players:
        assert p.hp <= p.max_hp
        assert p.alive == (p.hp > 0)


def test_same_seed_replays_identically():
    a, _ = bot_game(6, 1234)
    b, _ = bot_game(6, 1234)
    assert a.log == b.log
