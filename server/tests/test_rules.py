import pytest

from content.standard import new_game
from engine import DiscardRequest, GameOver, RespondRequest
from engine.driver import drive

from .helpers import L, R, S, Y, assert_cards_conserved, game4, give, pass_all


# ---------------------------------------------------------------- distance / range

def test_distance_wraps_and_skips_the_dead():
    g = new_game(6, seed=0)
    assert g.distance(0, 1) == 1
    assert g.distance(0, 3) == 3
    assert g.distance(0, 5) == 1
    g.players[1].alive = False
    assert g.distance(0, 2) == 1


def test_strike_only_reaches_attack_range():
    g = new_game(6, seed=0)
    (s,) = give(g, 0, "strike")
    assert set(g.play_options(g.players[0])[s].candidates) == {1, 5}


# ---------------------------------------------------------------- strike / dodge / peach

def test_strike_hits_without_dodge():
    g = game4()
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), pass_all)
    assert g.players[1].hp == 3
    assert g.cards[s] in g.discard_pile
    assert_cards_conserved(g)


def test_dodge_cancels_strike():
    g = game4()
    (s,) = give(g, 0, "strike")
    (d,) = give(g, 1, "dodge")

    def agent(req):
        assert isinstance(req, RespondRequest)
        assert (req.seat, req.card_name, req.about) == (1, "dodge", 0)
        return d

    drive(g.use_card(0, s, [1]), agent)
    assert g.players[1].hp == 4
    assert g.cards[d] in g.discard_pile


def test_choosing_not_to_dodge_takes_damage():
    g = game4()
    (s,) = give(g, 0, "strike")
    give(g, 1, "dodge")
    drive(g.use_card(0, s, [1]), pass_all)
    assert g.players[1].hp == 3
    assert len(g.players[1].hand) == 1


def test_one_strike_per_turn():
    g = game4()
    s1, s2 = give(g, 0, "strike", "strike")
    assert s2 in g.play_options(g.players[0])
    drive(g.use_card(0, s1, [1]), pass_all)
    assert s2 not in g.play_options(g.players[0])


def test_peach_only_when_wounded_and_caps_at_max():
    g = game4()
    p1, p2 = give(g, 0, "peach", "peach")
    assert p1 not in g.play_options(g.players[0])
    g.players[0].hp = 3
    assert p1 in g.play_options(g.players[0])
    drive(g.use_card(0, p1, []), pass_all)
    assert g.players[0].hp == 4
    assert p2 not in g.play_options(g.players[0])


def test_invalid_answer_is_reasked_with_error():
    g = game4()
    (s,) = give(g, 0, "strike")
    (d,) = give(g, 1, "dodge")
    gen = g.use_card(0, s, [1])
    req = next(gen)
    again = gen.send(9999)
    assert again is req and req.error
    with pytest.raises(StopIteration):
        gen.send(d)
    assert g.players[1].hp == 4


# ---------------------------------------------------------------- dying / death

def test_dying_player_saved_by_someone_else():
    g = game4(L, Y, R, S)
    g.players[2].hp = 1
    (s,) = give(g, 1, "strike")
    (pc,) = give(g, 3, "peach")

    def agent(req):
        assert (req.seat, req.card_name, req.about) == (3, "peach", 2)
        return pc

    drive(g.use_card(1, s, [2]), agent)
    assert g.players[2].alive and g.players[2].hp == 1


def test_dying_player_can_save_themselves():
    g = game4()
    g.players[1].hp = 1
    (s,) = give(g, 0, "strike")
    (pc,) = give(g, 1, "peach")
    drive(g.use_card(0, s, [1]), lambda req: pc if req.card_name == "peach" else None)
    assert g.players[1].alive and g.players[1].hp == 1


def test_killing_a_rebel_draws_three():
    g = game4(L, R, Y, S)
    g.players[1].hp = 1
    (s,) = give(g, 0, "strike")
    give(g, 1, "strike", "dodge")
    drive(g.use_card(0, s, [1]), pass_all)
    assert not g.players[1].alive
    assert g.players[1].hand == []
    assert len(g.players[0].hand) == 3
    death = next(e for e in g.log if e["type"] == "death")
    assert death == {"type": "death", "seat": 1, "role": "rebel", "killer": 0}
    assert_cards_conserved(g)


def test_lord_killing_loyalist_discards_everything():
    g = game4(L, Y, R, S)
    g.players[1].hp = 1
    s, *_ = give(g, 0, "strike", "dodge", "peach")
    drive(g.use_card(0, s, [1]), pass_all)
    assert not g.players[1].alive
    assert g.players[0].hand == []


# ---------------------------------------------------------------- victory

def test_rebels_win_when_lord_dies():
    g = game4(R, L, Y, S)
    g.players[1].hp = 1
    (s,) = give(g, 0, "strike")
    with pytest.raises(GameOver) as over:
        drive(g.use_card(0, s, [1]), pass_all)
    assert over.value.result.side == "rebel"
    assert over.value.result.winners == [0]


def test_spy_wins_only_as_last_survivor():
    g = game4(L, Y, R, S)
    g.players[1].alive = g.players[2].alive = False
    g.players[0].hp = 1
    (s,) = give(g, 3, "strike")
    with pytest.raises(GameOver) as over:
        drive(g.use_card(3, s, [0]), pass_all)
    assert over.value.result.side == "spy"
    assert over.value.result.winners == [3]


def test_lord_side_wins_when_rebels_and_spy_gone():
    g = game4(L, Y, R, S)
    g.players[3].alive = False
    g.players[2].hp = 1
    (s,) = give(g, 0, "strike")
    with pytest.raises(GameOver) as over:
        drive(g.use_card(0, s, [2]), pass_all)
    assert over.value.result.side == "lord"
    assert over.value.result.winners == [0, 1]


# ---------------------------------------------------------------- discard phase

def test_discard_down_to_hp():
    g = game4()
    give(g, 0, "strike", "strike", "dodge", "dodge", "peach", "peach")
    seen = []

    def agent(req):
        assert isinstance(req, DiscardRequest)
        seen.append(req.count)
        return req.options[:2]

    drive(g.phase_discard(g.players[0]), agent)
    assert seen == [2]
    assert len(g.players[0].hand) == 4
