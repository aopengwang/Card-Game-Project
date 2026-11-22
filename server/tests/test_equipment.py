from collections import Counter

import pytest

from bots import SimpleBot
from content.standard import build_deck, new_game
from engine import Convert, Play, PlayRequest, Suit
from engine.driver import InvalidAnswer, drive, play_game
from engine.view import view_for

from .helpers import assert_cards_conserved, equip, game4, give, give_where, pass_all, stack_top


def agent(**by_kind):
    """Answer by request kind ("respond", "confirm", ...); a value may be a callable(req)."""

    def answer(req):
        if req.kind in by_kind:
            h = by_kind[req.kind]
            return h(req) if callable(h) else h
        return req.default()

    return answer


def first_option(req):
    return req.options[0]


def candidates(g, seat, card_id):
    return set(g.play_options(g.players[seat])[card_id].candidates)


# ---------------------------------------------------------------- deck


def test_full_deck_is_108_cards():
    deck = build_deck()
    assert len(deck) == 108
    n = Counter(c.name for c in deck)
    assert (n["strike"], n["dodge"], n["peach"]) == (30, 15, 8)
    assert n["plus_horse"] == n["minus_horse"] == 3
    assert n["borrowed_sword"] == 2 and n["crossbow"] == 2 and n["eight_trigrams"] == 2


# ---------------------------------------------------------------- equipping


def test_equip_from_hand_and_replace_same_slot():
    g = game4()
    a, b, h = give(g, 0, "crossbow", "halberd", "plus_horse")
    assert g.play_options(g.players[0])[a].target_count == 0
    drive(g.use_card(0, a, []), pass_all)
    drive(g.use_card(0, h, []), pass_all)
    assert [c.id for c in g.players[0].equips] == [a, h]
    drive(g.use_card(0, b, []), pass_all)
    assert {c.id for c in g.players[0].equips} == {b, h}
    assert g.cards[a] in g.discard_pile
    assert_cards_conserved(g)


def test_weapon_sets_attack_range():
    g = new_game(6, seed=0)
    (s,) = give(g, 0, "strike")
    assert candidates(g, 0, s) == {1, 5}
    equip(g, 0, "piercing_sword")  # range 2
    assert candidates(g, 0, s) == {1, 2, 4, 5}
    assert view_for(g, 0)["attack_range"] == 2


def test_horses_change_distance_but_never_below_one():
    g = game4()
    equip(g, 1, "plus_horse")
    (s,) = give(g, 0, "strike")
    assert g.distance(0, 1) == 2 and g.distance(1, 0) == 1
    assert candidates(g, 0, s) == {3}
    equip(g, 0, "minus_horse")
    assert g.distance(0, 1) == 1 and g.distance(0, 2) == 1 and g.distance(0, 3) == 1
    assert candidates(g, 0, s) == {1, 2, 3}
    assert [p["distance"] for p in view_for(g, 0)["players"]] == [None, 1, 1, 1]


def test_minus_horse_extends_snatch():
    g = game4()
    (sn,) = give(g, 0, "snatch")
    for seat in (1, 2, 3):
        give(g, seat, "dodge")
    assert candidates(g, 0, sn) == {1, 3}
    equip(g, 0, "minus_horse")
    assert candidates(g, 0, sn) == {1, 2, 3}


def test_death_discards_equipment():
    g = game4()
    equip(g, 1, "crossbow")
    equip(g, 1, "eight_trigrams")
    g.players[1].hp = 1
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), pass_all)  # declines the trigrams judgment
    assert not g.players[1].alive and g.players[1].equips == []
    assert_cards_conserved(g)


# ---------------------------------------------------------------- weapons


def test_crossbow_allows_unlimited_strikes():
    g = game4()
    equip(g, 0, "crossbow")
    s1, s2 = give(g, 0, "strike", "strike")
    drive(g.use_card(0, s1, [1]), pass_all)
    assert s2 in g.play_options(g.players[0])


def test_piercing_sword_ignores_armor():
    g = game4()
    equip(g, 0, "piercing_sword")
    equip(g, 1, "eight_trigrams")
    (s,) = give(g, 0, "strike")
    kinds = []
    drive(g.use_card(0, s, [1]), lambda r: kinds.append(r.kind) or r.default())
    assert "confirm" not in kinds
    assert g.players[1].hp == 3


def test_twin_swords_opposite_gender_choice():
    for choice, p1_hand, p0_hand in [("discard", 0, 0), ("let_draw", 1, 1)]:
        g = game4()
        equip(g, 0, "twin_swords")
        g.players[1].gender = "female"
        give(g, 1, "peach")
        (s,) = give(g, 0, "strike")
        drive(g.use_card(0, s, [1]), agent(confirm=True, choose_option=choice))
        assert len(g.players[1].hand) == p1_hand and len(g.players[0].hand) == p0_hand
        assert g.players[1].hp == 3


def test_twin_swords_same_gender_does_nothing():
    g = game4()
    equip(g, 0, "twin_swords")
    (s,) = give(g, 0, "strike")
    kinds = []
    drive(g.use_card(0, s, [1]), lambda r: kinds.append(r.kind) or r.default())
    assert kinds == []


def test_frost_blade_trades_damage_for_two_discards():
    g = game4()
    equip(g, 0, "frost_blade")
    give(g, 1, "peach", "dodge")
    h = equip(g, 3, "minus_horse")
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [3]), agent(confirm=True))
    assert g.players[3].hp == 4 and g.players[3].equips == []
    assert g.cards[h] in g.discard_pile

    g = game4()
    equip(g, 0, "frost_blade")
    give(g, 1, "peach", "peach", "peach")
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), agent(confirm=False))
    assert g.players[1].hp == 3 and len(g.players[1].hand) == 3


def test_dragon_glaive_strikes_again_after_a_dodge():
    g = game4()
    equip(g, 0, "dragon_glaive")
    s1, _ = give(g, 0, "strike", "strike")
    give(g, 1, "dodge")
    drive(g.use_card(0, s1, [1]), agent(respond=first_option))
    assert g.players[1].hp == 3
    assert g.players[0].hand == [] and g.players[1].hand == []
    assert g.players[0].strikes_used == 1  # the follow-up is free


def test_stone_axe_pays_two_cards_to_force_the_hit():
    g = game4()
    axe = equip(g, 0, "stone_axe")
    (s,) = give(g, 0, "strike")
    give(g, 0, "peach", "peach")
    give(g, 1, "dodge")
    seen = []

    def discard(req):
        seen.append(req.options)
        return req.default()

    drive(g.use_card(0, s, [1]), agent(respond=first_option, confirm=True, discard=discard))
    assert g.players[1].hp == 3
    assert g.players[0].hand == [] and [c.id for c in g.players[0].equips] == [axe]
    assert axe not in seen[0]


def test_serpent_spear_two_cards_as_a_strike_in_play():
    g = game4()
    equip(g, 0, "serpent_spear")
    a, b = give(g, 0, "peach", "dodge")
    (conv,) = g.play_conversions(g.players[0])
    assert (conv.as_name, conv.count, set(conv.candidates)) == ("strike", 2, {1, 2, 3})
    answers = iter([Play(skill="serpent_spear", cards=(a, b), targets=(2,)), None])
    drive(g.phase_play(g.players[0]), lambda r: next(answers) if isinstance(r, PlayRequest) else r.default())
    assert g.players[2].hp == 3
    assert g.players[0].hand == [] and g.players[0].strikes_used == 1
    use = next(e for e in g.log if e["type"] == "use")
    assert use["card"]["virtual"] and use["card"]["color"] == "red"
    assert {c["id"] for c in use["subcards"]} == {a, b}
    assert_cards_conserved(g)


def test_serpent_spear_in_response_and_validation():
    g = game4()
    equip(g, 1, "serpent_spear")
    a, b = give(g, 1, "peach", "dodge")
    (bb,) = give(g, 0, "barbarians")

    def respond(req):
        assert req.options == [] and req.conversions[0].skill == "serpent_spear"
        return Convert("serpent_spear", (a, b))

    drive(g.use_card(0, bb, []), agent(respond=respond))
    assert [p.hp for p in g.players] == [4, 4, 3, 3]

    g = game4()
    equip(g, 1, "serpent_spear")
    a, _ = give(g, 1, "peach", "dodge")
    (bb,) = give(g, 0, "barbarians")
    with pytest.raises(InvalidAnswer, match="exactly 2"):
        drive(g.use_card(0, bb, []), agent(respond=lambda r: Convert("serpent_spear", (a,))))


def test_halberd_last_card_hits_three():
    g = game4()
    equip(g, 0, "halberd")
    (s,) = give(g, 0, "strike")
    opt = g.play_options(g.players[0])[s]
    assert (opt.min_targets, opt.target_count) == (1, 3)
    drive(g.use_card(0, s, [1, 2, 3]), pass_all)
    assert [p.hp for p in g.players] == [4, 3, 3, 3]

    g = game4()
    equip(g, 0, "halberd")
    (s,) = give(g, 0, "strike")
    give(g, 0, "peach")
    assert g.play_options(g.players[0])[s].target_count == 1
    req = PlayRequest(seat=0, options=g.play_options(g.players[0]))
    assert req.validate(Play(s, (1, 2))) is not None


def test_kirin_bow_shoots_a_horse():
    g = game4()
    equip(g, 0, "kirin_bow")
    h = equip(g, 2, "plus_horse")
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [2]), agent(choose_card=first_option))
    assert g.players[2].hp == 3 and g.players[2].equips == []
    assert g.cards[h] in g.discard_pile


# ---------------------------------------------------------------- armor


def test_eight_trigrams_red_judgment_is_a_dodge():
    g = game4()
    equip(g, 1, "eight_trigrams")
    (s,) = give(g, 0, "strike")
    stack_top(g, lambda c: c.suit == Suit.HEART)
    drive(g.use_card(0, s, [1]), agent(confirm=True))
    assert g.players[1].hp == 4
    assert any(e["type"] == "respond" and e.get("via") == "eight_trigrams" for e in g.log)
    assert g.processing == []


def test_eight_trigrams_black_falls_back_to_hand():
    g = game4()
    equip(g, 1, "eight_trigrams")
    give(g, 1, "dodge")
    (s,) = give(g, 0, "strike")
    stack_top(g, lambda c: c.suit == Suit.SPADE)
    drive(g.use_card(0, s, [1]), agent(confirm=True, respond=first_option))
    assert g.players[1].hp == 4 and g.players[1].hand == []

    g = game4()
    equip(g, 1, "eight_trigrams")
    (s,) = give(g, 0, "strike")
    stack_top(g, lambda c: c.suit == Suit.CLUB)
    drive(g.use_card(0, s, [1]), agent(confirm=True))
    assert g.players[1].hp == 3


def test_eight_trigrams_also_works_against_arrows():
    g = game4()
    equip(g, 2, "eight_trigrams")
    (a,) = give(g, 0, "arrows")
    stack_top(g, lambda c: c.suit == Suit.DIAMOND)
    drive(g.use_card(0, a, []), agent(confirm=True))
    assert [p.hp for p in g.players] == [4, 3, 4, 3]


def test_benevolent_shield_blocks_black_strikes_only():
    g = game4()
    equip(g, 1, "benevolent_shield")
    black = give_where(g, 0, lambda c: c.name == "strike" and c.suit == Suit.CLUB)
    red = give_where(g, 0, lambda c: c.name == "strike" and c.suit == Suit.HEART)
    drive(g.use_card(0, black, [1]), pass_all)
    assert g.players[1].hp == 4
    drive(g.use_card(0, red, [1]), pass_all)
    assert g.players[1].hp == 3


# ---------------------------------------------------------------- borrowed sword


def test_borrowed_sword_needs_someone_with_a_weapon():
    g = game4()
    (bs,) = give(g, 0, "borrowed_sword")
    assert bs not in g.play_options(g.players[0])
    equip(g, 2, "crossbow")
    assert candidates(g, 0, bs) == {2}


def test_borrowed_sword_wielder_strikes_the_victim():
    g = game4()
    (bs,) = give(g, 0, "borrowed_sword")
    w = equip(g, 1, "crossbow")
    give(g, 1, "strike")
    seen = []

    def choose_player(req):
        seen.append(sorted(req.options))
        return 2

    drive(g.use_card(0, bs, [1]), agent(choose_player=choose_player, respond=first_option))
    assert seen == [[0, 2]]  # crossbow range 1 from seat 1
    assert g.players[2].hp == 3
    assert [c.id for c in g.players[1].equips] == [w]


def test_borrowed_sword_refusal_hands_over_the_weapon():
    g = game4()
    (bs,) = give(g, 0, "borrowed_sword")
    w = equip(g, 1, "crossbow")
    give(g, 1, "strike")
    drive(g.use_card(0, bs, [1]), agent(choose_player=2, respond=None))
    assert g.players[2].hp == 4
    assert g.players[1].equips == [] and [c.id for c in g.players[0].hand] == [w]
    assert_cards_conserved(g)


# ---------------------------------------------------------------- bots


def test_bot_games_exercise_equipment():
    used = Counter()
    for seed in range(20):
        g = new_game(5, seed)
        play_game(g, [SimpleBot(seed * 10 + i) for i in range(5)])
        assert_cards_conserved(g)
        used.update(e["card"]["name"] for e in g.log if e["type"] == "equip")
    assert len(used) >= 10, used
