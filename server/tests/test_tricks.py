from engine import HAND, ChooseCardRequest, Phase, RespondRequest, Suit, Zone
from engine.driver import drive
from content.standard import new_game
from engine.view import log_for

from .helpers import L, R, S, Y, assert_cards_conserved, game4, give, pass_all, stack_top


def by_kind(**handlers):
    """Agent dispatching on (kind, card_name/reason); unknown requests get the default."""

    def agent(req):
        key = req.kind
        if isinstance(req, RespondRequest):
            key = f"respond:{req.card_name}:{req.seat}"
        elif isinstance(req, ChooseCardRequest):
            key = f"choose:{req.seat}"
        h = handlers.get(key)
        return h(req) if h else req.default()

    return agent


# ---------------------------------------------------------------- nullify

def test_ex_nihilo_draws_two():
    g = game4()
    (x,) = give(g, 0, "ex_nihilo")
    assert g.play_options(g.players[0])[x].target_count == 0
    drive(g.use_card(0, x, []), pass_all)
    assert len(g.players[0].hand) == 2
    assert_cards_conserved(g)


def test_nullify_cancels_and_counter_nullify_restores():
    g = game4()
    (x,) = give(g, 0, "ex_nihilo")
    (n2,) = give(g, 2, "nullify")
    drive(g.use_card(0, x, []), by_kind(**{"respond:nullify:2": lambda r: n2}))
    assert len(g.players[0].hand) == 0  # cancelled

    g = game4()
    (x,) = give(g, 0, "ex_nihilo")
    (n2,) = give(g, 2, "nullify")
    (n1,) = give(g, 1, "nullify")
    contexts = []

    def save(req):
        contexts.append(dict(req.context))
        return req.options[0]

    drive(g.use_card(0, x, []), by_kind(**{"respond:nullify:2": save, "respond:nullify:1": save}))
    assert len(g.players[0].hand) == 2  # nullified, then un-nullified
    assert [c["cancelled"] for c in contexts] == [False, True]
    assert [e["cancelled"] for e in g.log if e["type"] == "nullify"] == [True, False]


def test_player_may_counter_their_own_nullify_chain():
    g = game4()
    (x,) = give(g, 0, "ex_nihilo")
    n_a, n_b = give(g, 1, "nullify", "nullify")
    drive(g.use_card(0, x, []), by_kind(**{"respond:nullify:1": lambda r: r.options[0]}))
    # P1 nullifies, then (asked again) nullifies their own nullify -> effect happens
    assert len(g.players[0].hand) == 2
    assert g.players[1].hand == []


# ---------------------------------------------------------------- targeted tricks

def test_dismantle_hand_card_is_hidden_and_random():
    g = game4()
    (d,) = give(g, 0, "dismantle")
    give(g, 1, "peach", "dodge")
    seen = []

    def choose(req):
        seen.append((req.options, req.hidden_count, req.about))
        return HAND

    drive(g.use_card(0, d, [1]), by_kind(**{"choose:0": choose}))
    assert seen == [([], 2, 1)]
    assert len(g.players[1].hand) == 1
    assert_cards_conserved(g)


def test_dismantle_can_remove_a_delayed_trick():
    g = game4()
    (d,) = give(g, 0, "dismantle")
    (ind,) = give(g, 3, "indulgence")
    drive(g.use_card(3, ind, [1]), pass_all)
    assert [c.id for c in g.players[1].judge] == [ind]
    drive(g.use_card(0, d, [1]), by_kind(**{"choose:0": lambda r: ind}))
    assert g.players[1].judge == []
    assert g.cards[ind] in g.discard_pile


def test_snatch_range_and_private_log():
    g = new_game(6, seed=0)
    (s,) = give(g, 0, "snatch")
    for seat in range(1, 6):
        give(g, seat, "dodge")
    assert set(g.play_options(g.players[0])[s].candidates) == {1, 5}
    drive(g.use_card(0, s, [1]), pass_all)
    assert len(g.players[0].hand) == 1 and g.players[1].hand == []
    take = [e for e in log_for(g, 0) if e["type"] == "take"][0]
    assert take["card"]["name"] == "dodge"
    assert "card" not in [e for e in log_for(g, 3) if e["type"] == "take"][0]


def test_cannot_target_player_with_no_cards():
    g = game4()
    (d,) = give(g, 0, "dismantle")
    give(g, 1, "dodge")
    assert g.play_options(g.players[0])[d].candidates == (1,)


def test_duel_alternates_strikes_target_first():
    g = game4()
    (du,) = give(g, 0, "duel")
    give(g, 2, "strike")
    give(g, 0, "strike", "strike")
    drive(g.use_card(0, du, [2]), lambda r: r.options[0] if isinstance(r, RespondRequest) else r.default())
    # P2 strikes, P0 strikes, P2 has none -> P2 damaged
    assert g.players[2].hp == 3 and g.players[0].hp == 4
    assert len(g.players[0].hand) == 1

    g = game4()
    (du,) = give(g, 0, "duel")
    give(g, 2, "strike")
    drive(g.use_card(0, du, [2]), lambda r: r.options[0] if isinstance(r, RespondRequest) else r.default())
    assert g.players[0].hp == 3 and g.players[2].hp == 4  # the user can lose their own duel


# ---------------------------------------------------------------- area tricks

def test_barbarians_hits_everyone_without_a_strike_in_seat_order():
    g = game4()
    (b,) = give(g, 1, "barbarians")
    give(g, 3, "strike")
    asked = []

    def agent(req):
        asked.append(req.seat)
        return req.options[0]

    drive(g.use_card(1, b, []), agent)
    assert [p.hp for p in g.players] == [3, 4, 3, 4]
    assert asked == [3]
    assert [e["targets"] for e in g.log if e["type"] == "use"] == [[2, 3, 0]]


def test_arrows_needs_dodges():
    g = game4()
    (a,) = give(g, 0, "arrows")
    give(g, 2, "dodge")
    drive(g.use_card(0, a, []), lambda r: r.options[0])
    assert [p.hp for p in g.players] == [4, 3, 4, 3]


def test_nullify_protects_only_one_target_of_an_area_trick():
    g = game4()
    (a,) = give(g, 0, "arrows")
    (n,) = give(g, 2, "nullify")
    drive(g.use_card(0, a, []), by_kind(**{"respond:nullify:2": lambda r: n if r.about == 2 else None}))
    assert [p.hp for p in g.players] == [4, 3, 4, 3]


def test_peach_garden_heals_wounded_only():
    g = game4()
    (pg,) = give(g, 0, "peach_garden")
    g.players[1].hp = 2
    g.players[2].hp = 3
    drive(g.use_card(0, pg, []), pass_all)
    assert [p.hp for p in g.players] == [4, 3, 4, 4]


def test_harvest_each_player_picks_in_order():
    g = game4()
    (h,) = give(g, 1, "harvest")
    picks = []

    def choose(req):
        picks.append((req.seat, len(req.options)))
        return req.options[0]

    drive(g.use_card(1, h, []), lambda r: choose(r) if isinstance(r, ChooseCardRequest) else r.default())
    assert picks == [(1, 4), (2, 3), (3, 2), (0, 1)]
    assert all(len(p.hand) == 1 for p in g.players)
    assert g.processing == []
    assert_cards_conserved(g)


def test_harvest_leftover_is_discarded_when_someone_is_nullified():
    g = game4()
    (h,) = give(g, 0, "harvest")
    (n,) = give(g, 1, "nullify")
    drive(
        g.use_card(0, h, []),
        lambda r: (n if r.about == 3 else None) if isinstance(r, RespondRequest) else r.default(),
    )
    assert len(g.players[3].hand) == 0
    assert g.processing == []
    assert_cards_conserved(g)


# ---------------------------------------------------------------- delayed tricks / judgment

def test_indulgence_skips_play_phase_unless_heart():
    g = game4()
    (ind,) = give(g, 0, "indulgence")
    drive(g.use_card(0, ind, [1]), pass_all)
    stack_top(g, lambda c: c.suit == Suit.SPADE)
    drive(g.phase_judge(g.players[1]), pass_all)
    assert Phase.PLAY in g.players[1].skip_phases
    assert g.players[1].judge == [] and g.cards[ind] in g.discard_pile

    g = game4()
    (ind,) = give(g, 0, "indulgence")
    drive(g.use_card(0, ind, [1]), pass_all)
    stack_top(g, lambda c: c.suit == Suit.HEART)
    drive(g.phase_judge(g.players[1]), pass_all)
    assert Phase.PLAY not in g.players[1].skip_phases


def test_indulgence_cannot_stack():
    g = game4()
    i1, i2 = give(g, 0, "indulgence", "indulgence")
    drive(g.use_card(0, i1, [1]), pass_all)
    assert 1 not in g.play_options(g.players[0])[i2].candidates


def test_indulged_turn_has_no_play_request():
    g = game4()
    (ind,) = give(g, 3, "indulgence")
    drive(g.use_card(3, ind, [0]), pass_all)
    stack_top(g, lambda c: c.suit == Suit.CLUB)
    kinds = []

    def agent(req):
        kinds.append(req.kind)
        return req.default()

    drive(g.take_turn(0), agent)
    assert "play" not in kinds
    assert any(e["type"] == "phase_skipped" and e["phase"] == "play" for e in g.log)


def test_lightning_strikes_on_spade_2_to_9():
    g = game4()
    (lt,) = give(g, 0, "lightning")
    drive(g.use_card(0, lt, []), pass_all)
    assert [c.id for c in g.players[0].judge] == [lt]
    stack_top(g, lambda c: c.suit == Suit.SPADE and 2 <= c.rank <= 9)
    drive(g.phase_judge(g.players[0]), pass_all)
    assert g.players[0].hp == 1
    assert g.cards[lt] in g.discard_pile
    dmg = next(e for e in g.log if e["type"] == "damage")
    assert dmg["source"] is None and dmg["nature"] == "thunder"


def test_lightning_moves_on_when_it_misses_or_is_nullified():
    g = game4()
    (lt,) = give(g, 0, "lightning")
    drive(g.use_card(0, lt, []), pass_all)
    stack_top(g, lambda c: c.suit == Suit.HEART)
    drive(g.phase_judge(g.players[0]), pass_all)
    assert g.players[0].hp == 4 and [c.id for c in g.players[1].judge] == [lt]

    (n,) = give(g, 2, "nullify")
    drive(g.phase_judge(g.players[1]), lambda r: n)
    assert [c.id for c in g.players[2].judge] == [lt]
    assert not any(e["type"] == "judge" and e["seat"] == 1 for e in g.log)


def test_lightning_kill_gives_no_reward():
    g = game4(L, R, Y, S)
    g.current = 1
    g.players[1].hp = 2
    (lt,) = give(g, 1, "lightning")
    drive(g.use_card(1, lt, []), pass_all)
    stack_top(g, lambda c: c.suit == Suit.SPADE and 2 <= c.rank <= 9)
    drive(g.phase_judge(g.players[1]), pass_all)
    assert not g.players[1].alive
    assert g.turn_over
    assert all(len(p.hand) == 0 for p in g.players)
