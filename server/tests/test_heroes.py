from collections import Counter

import pytest

from bots import SimpleBot
from content.heroes import HEROES
from content.standard import new_game
from engine import ChooseHeroRequest, Phase, Play, PlayRequest, Suit
from engine.driver import InvalidAnswer, drive, play_game
from engine.view import view_for

from .helpers import L, R, S, Y, assert_cards_conserved, equip, give, give_where, pass_all, stack_top


def heroes(*ids, roles=(L, Y, R, S), seed=0):
    return new_game(len(ids), seed, list(roles), heroes=list(ids))


def script(*plays, **by_kind):
    """PlayRequests are answered from `plays` in order (then None = end phase); other
    requests by kind (value or callable(req)); anything else gets its default."""
    plays_left = list(plays)

    def answer(req):
        if isinstance(req, PlayRequest):
            return plays_left.pop(0) if plays_left else None
        h = by_kind.get(req.kind)
        if h is None:
            return req.default()
        return h(req) if callable(h) else h

    return answer


def first(req):
    return req.options[0]


def drawn(g, reason):
    return sum(e["count"] for e in g.log if e["type"] == "draw" and e["reason"] == reason)


def skill_names(g, seat):
    return {s.name for s in g.skills_of(g.players[seat])}


# ---------------------------------------------------------------- roster & draft


def test_roster_is_well_formed():
    assert len({h.id for h in HEROES}) == len(HEROES) == 14
    names = [s.name for h in HEROES for s in h.skills]
    assert len(names) == len(set(names))
    assert all((type(s).__doc__ or "").strip() for h in HEROES for s in h.skills)
    assert sorted(h.id for h in HEROES if h.has_lord_skill) == ["cao_cao", "liu_bei", "sun_quan", "wei_lie"]
    assert Counter(str(h.kingdom) for h in HEROES) == {"wei": 4, "shu": 3, "wu": 3, "qun": 4}


def test_draft_lord_picks_first_then_others_from_untaken():
    g = new_game(5, seed=1, draft=True)
    gen = g.run()
    req = next(gen)
    assert isinstance(req, ChooseHeroRequest) and req.seat == g.lord_seat
    assert {"cao_cao", "liu_bei", "sun_quan", "wei_lie"} <= set(req.options) and len(req.options) == 6
    req = gen.send("liu_bei")
    taken = {"liu_bei"}
    while isinstance(req, ChooseHeroRequest):
        assert len(req.options) == 3 and not taken & set(req.options)
        taken.add(req.options[0])
        req = gen.send(req.options[0])
    assert isinstance(req, PlayRequest)
    lord = g.players[g.lord_seat]
    assert (lord.hero, lord.max_hp, lord.hp) == ("liu_bei", 5, 5)
    assert {p.hero for p in g.players} == taken
    assert any(e["type"] == "heroes_revealed" for e in g.log)


def test_lord_skills_only_work_for_the_lord():
    g = heroes("guan_yu", "cao_cao", None, None)
    assert "northern_levy" not in skill_names(g, 1)
    assert [s["id"] for s in view_for(g, 0)["players"][1]["skills"]] == ["iron_edict"]
    g = heroes("cao_cao", None, None, None)
    assert "northern_levy" in skill_names(g, 0)
    tags = view_for(g, 2)["players"][0]["skills"][1]["tags"]
    assert tags == ["locked", "lord"]


# ---------------------------------------------------------------- wei


def test_iron_edict_give_or_take_damage_once_per_turn():
    g = heroes("cao_cao", None, None, None)
    (pe,) = give(g, 0, "peach")
    (do,) = give(g, 1, "dodge")
    give(g, 0, "dodge")
    drive(
        g.phase_play(g.players[0]),
        script(Play(skill="iron_edict", cards=(pe,), targets=(1,)), choose_option="give_card", choose_card=first),
    )
    assert do in [c.id for c in g.players[0].hand] and g.players[1].hand == []
    assert g.cards[pe] in g.discard_pile
    assert not g.active_options(g.players[0])  # once per turn

    g = heroes("cao_cao", None, None, None)
    (pe,) = give(g, 0, "peach")
    drive(g.phase_play(g.players[0]), script(Play(skill="iron_edict", cards=(pe,), targets=(2,))))
    assert g.players[2].hp == 3  # empty hand: damage is the only choice


def test_northern_levy_once_per_turn_for_other_wei():
    g = heroes("cao_cao", "sima_yi", "guan_yu", None)
    drive(g.damage(None, 2, 1), pass_all)
    assert len(g.players[0].hand) == 0
    drive(g.damage(None, 1, 1), pass_all)
    drive(g.damage(None, 1, 1), pass_all)
    assert len(g.players[0].hand) == 1


def test_patient_scheme_rewards_passing():
    g = heroes("sima_yi", None, None, None)
    drive(g.take_turn(0), pass_all)
    assert drawn(g, "patient_scheme") == 2 and len(g.players[0].hand) == 4

    g = heroes("sima_yi", None, None, None)
    (x,) = give(g, 0, "ex_nihilo")
    drive(g.take_turn(0), script(Play(x)))
    assert drawn(g, "patient_scheme") == 0


def test_wolf_rises_awakens_once_and_grants_seize_power():
    g = heroes("sima_yi", None, None, None)
    drive(g.take_turn(0), pass_all)
    assert "seize_power" not in skill_names(g, 0)

    g = heroes("sima_yi", None, None, None)
    g.players[0].hp = 2
    drive(g.take_turn(0), pass_all)
    p = g.players[0]
    assert (p.max_hp, p.hp) == (2, 2) and "seize_power" in skill_names(g, 0)
    assert view_for(g, 1)["players"][0]["spent"] == ["wolf_rises"]
    drive(g.take_turn(0), pass_all)
    assert p.max_hp == 2  # doesn't fire again

    a, b = give(g, 0, "peach", "dodge")
    h = equip(g, 2, "plus_horse")  # distance doesn't matter
    drive(
        g.phase_play(p),
        script(Play(skill="seize_power", cards=(a, b), targets=(2,)), choose_card=lambda r: h),
    )
    assert h in [c.id for c in p.hand] and g.players[2].equips == []
    assert_cards_conserved(g)


def test_fearless_vanguard_bonus_vs_bigger_hand_once_per_turn():
    g = heroes("zhang_liao", None, None, None)
    equip(g, 0, "crossbow")
    s1, s2 = give(g, 0, "strike", "strike")
    give(g, 1, "peach", "peach", "peach")
    drive(g.use_card(0, s1, [1]), pass_all)
    assert g.players[1].hp == 2
    drive(g.use_card(0, s2, [1]), pass_all)
    assert g.players[1].hp == 1

    g = heroes("zhang_liao", None, None, None)
    (s,) = give(g, 0, "strike")
    give(g, 0, "peach")
    drive(g.use_card(0, s, [1]), pass_all)  # target has 0 cards vs our 1
    assert g.players[1].hp == 3


def test_spoils_of_war_takes_the_damaging_card():
    g = heroes(None, "wei_lie", None, None)
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), pass_all)
    assert [c.id for c in g.players[1].hand] == [s] and g.players[1].hp == 3
    assert_cards_conserved(g)


def test_spoils_of_war_takes_all_converted_cards_and_area_tricks():
    g = heroes(None, "wei_lie", None, None)
    equip(g, 0, "serpent_spear")
    a, b = give(g, 0, "peach", "dodge")
    drive(g.phase_play(g.players[0]), script(Play(skill="serpent_spear", cards=(a, b), targets=(1,))))
    assert {c.id for c in g.players[1].hand} == {a, b}

    g = heroes(None, None, "wei_lie", None)
    (bb,) = give(g, 0, "barbarians")
    drive(g.use_card(0, bb, []), pass_all)
    assert [c.id for c in g.players[2].hand] == [bb]
    assert [p.hp for p in g.players] == [4, 3, 3, 3]  # the others still got hit
    assert_cards_conserved(g)


def test_spoils_of_war_draws_when_no_card_dealt_it():
    g = heroes(None, "wei_lie", None, None)
    drive(g.damage(None, 1, 1), pass_all)
    assert len(g.players[1].hand) == 1 and drawn(g, "spoils_of_war") == 1


def test_shield_wall_wei_allies_dodge_for_the_lord():
    g = heroes("wei_lie", "sima_yi", "guan_yu", "zhang_liao")
    give(g, 1, "dodge")
    (s,) = give(g, 2, "strike")
    asked = []

    def respond(req):
        asked.append((req.seat, req.reason))
        return req.options[0]

    drive(g.use_card(2, s, [0]), script(confirm=True, respond=respond))
    assert g.players[0].hp == 4 and g.players[1].hand == []
    assert asked == [(1, "shield_wall")]  # Guan Yu (Shu) is never asked; Zhang Liao had none
    assert any(e["type"] == "respond" and e.get("via") == "shield_wall" for e in g.log)


def test_shield_wall_ally_armor_and_refusal():
    g = heroes("wei_lie", "sima_yi", None, None)
    equip(g, 1, "eight_trigrams")
    (s,) = give(g, 2, "strike")
    stack_top(g, lambda c: c.suit == Suit.DIAMOND)
    drive(g.use_card(2, s, [0]), script(confirm=True))
    assert g.players[0].hp == 4  # the ally's armor judged red

    g = heroes("wei_lie", "sima_yi", None, None)
    give(g, 1, "dodge")
    (s,) = give(g, 2, "strike")
    drive(g.use_card(2, s, [0]), script(confirm=True, respond=None))
    assert g.players[0].hp == 3 and len(g.players[1].hand) == 1


def test_shield_wall_needs_lord():
    g = heroes("guan_yu", "wei_lie", "sima_yi", None)
    give(g, 2, "dodge")
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), script(confirm=True, respond=first))
    assert g.players[1].hp == 3 and len(g.players[2].hand) == 1


# ---------------------------------------------------------------- shu


def test_gather_the_righteous():
    g = heroes("liu_bei", None, None, None)
    a, _ = give(g, 0, "peach", "dodge")
    give(g, 2, "strike", "strike")
    (opt,) = g.active_options(g.players[0])
    assert set(opt.candidates) == {1, 3}  # seat 2 doesn't have fewer cards
    drive(g.phase_play(g.players[0]), script(Play(skill="gather_the_righteous", cards=(a,), targets=(1,))))
    assert len(g.players[0].hand) == 2 and len(g.players[1].hand) == 2
    assert a in [c.id for c in g.players[1].hand]


def test_heir_of_han_hand_limit():
    g = heroes("liu_bei", "guan_yu", "zhuge_liang", "cao_cao")
    assert g.hand_limit(g.players[0]) == 4 + 2
    g = heroes("cao_cao", "liu_bei", "guan_yu", None)
    assert g.hand_limit(g.players[1]) == 4  # not the lord


def test_steadfast_blade_draws_when_dodged():
    g = heroes("guan_yu", None, None, None)
    (s,) = give(g, 0, "strike")
    give(g, 1, "dodge")
    drive(g.use_card(0, s, [1]), script(respond=first))
    assert len(g.players[0].hand) == 1 and g.players[1].hp == 4


def test_east_wind_is_limited():
    g = heroes("zhuge_liang", None, None, None)
    drive(g.phase_play(g.players[0]), script(Play(skill="east_wind", targets=(1, 3))))
    assert [p.hp for p in g.players] == [3, 3, 4, 3]
    assert all(e["nature"] == "fire" for e in g.log if e["type"] == "damage")
    drive(g.take_turn(1), pass_all)  # turn usage resets...
    assert not g.active_options(g.players[0])  # ...but a limited skill stays spent
    with pytest.raises(InvalidAnswer, match="cannot be used"):
        drive(g.phase_play(g.players[0]), script(Play(skill="east_wind", targets=(1,))))


def test_strategist_draws_when_targeted_by_others_tricks():
    g = heroes(None, "zhuge_liang", None, None)
    (d,) = give(g, 0, "dismantle")
    give(g, 1, "dodge")
    drive(g.use_card(0, d, [1]), pass_all)
    assert len(g.players[1].hand) == 1  # drew 1, then lost 1
    (b,) = give(g, 0, "barbarians")
    drive(g.use_card(0, b, []), pass_all)
    assert drawn(g, "strategist") == 2


# ---------------------------------------------------------------- wu


def test_steady_hand_and_wu_ascendant():
    g = heroes("sun_quan", "zhou_yu", None, None)
    drive(g.take_turn(0), pass_all)
    assert drawn(g, "steady_hand") == 1
    g.players[1].hp = 2
    (pe,) = give(g, 1, "peach")
    drive(g.use_card(1, pe, []), pass_all)
    assert drawn(g, "wu_ascendant") == 1

    g = heroes("sun_quan", None, None, None)

    def turn_after_damage():
        yield from g.damage(2, 0, 1)
        yield from g.take_turn(0)

    drive(turn_after_damage(), pass_all)  # damage before the turn doesn't count...
    assert drawn(g, "steady_hand") == 1
    g2 = heroes("sun_quan", None, None, None)
    (x,) = give(g2, 0, "lightning")
    drive(g2.use_card(0, x, []), pass_all)
    stack_top(g2, lambda c: c.suit == Suit.SPADE and 2 <= c.rank <= 9)
    drive(g2.take_turn(0), pass_all)  # ...damage during it does
    assert drawn(g2, "steady_hand") == 0


def test_burning_fleet_same_suit_once_per_turn():
    g = heroes("zhou_yu", None, None, None)
    a = give_where(g, 0, lambda c: c.suit == Suit.CLUB)
    b = give_where(g, 0, lambda c: c.suit == Suit.CLUB)
    c = give_where(g, 0, lambda c: c.suit == Suit.HEART)
    d = give_where(g, 0, lambda c: c.suit == Suit.HEART)
    with pytest.raises(InvalidAnswer, match="same suit"):
        drive(g.phase_play(g.players[0]), script(Play(skill="burning_fleet", cards=(a, c))))

    g = heroes("zhou_yu", None, None, None)
    a = give_where(g, 0, lambda c: c.suit == Suit.CLUB)
    b = give_where(g, 0, lambda c: c.suit == Suit.CLUB)
    give_where(g, 0, lambda c: c.suit == Suit.HEART)
    give_where(g, 0, lambda c: c.suit == Suit.HEART)
    drive(g.phase_play(g.players[0]), script(Play(skill="burning_fleet", cards=(a, b))))
    assert [p.hp for p in g.players] == [3, 3, 3, 3]
    use = next(e for e in g.log if e["type"] == "use")
    assert use["card"]["name"] == "arrows" and use["card"]["suit"] == "club"
    assert g.play_conversions(g.players[0]) == []  # once per turn


def test_composure_hand_limit():
    g = heroes("zhou_yu", None, None, None)
    assert g.hand_limit(g.players[0]) == 3 + 1


def test_humble_blocks_duel_and_borrowed_sword():
    g = heroes(None, "lu_xun", None, None)
    du, bs, st = give(g, 0, "duel", "borrowed_sword", "strike")
    equip(g, 1, "crossbow")
    equip(g, 3, "crossbow")
    opts = g.play_options(g.players[0])
    assert 1 not in opts[du].candidates
    assert set(opts[bs].candidates) == {3}
    assert 1 in opts[st].candidates


def test_endurance_draws_per_damage():
    g = heroes(None, "lu_xun", None, None)
    drive(g.damage(0, 1, 2), pass_all)
    assert len(g.players[1].hand) == 2 and g.players[1].hp == 1


# ---------------------------------------------------------------- qun


def test_sky_piercer_range_and_heal_on_kill():
    g = heroes("lu_bu", None, None, None, roles=(L, R, Y, S))
    (s,) = give(g, 0, "strike")
    assert set(g.play_options(g.players[0])[s].candidates) == {1, 2, 3}
    g.players[0].hp = 2
    g.players[2].hp = 1
    drive(g.use_card(0, s, [2]), pass_all)
    assert not g.players[2].alive and g.players[0].hp == 3


def test_allure_strike_or_lose_a_card():
    g = heroes("diaochan", None, None, None)
    (gift,) = give(g, 0, "strike")
    drive(
        g.phase_play(g.players[0]),
        script(Play(skill="allure", cards=(gift,), targets=(1,)), choose_player=2, respond=first),
    )
    assert g.players[2].hp == 3  # P1 used the gifted Strike on P2
    assert g.players[1].hand == []

    g = heroes("diaochan", None, None, None)
    (gift,) = give(g, 0, "peach")
    drive(
        g.phase_play(g.players[0]),
        script(Play(skill="allure", cards=(gift,), targets=(1,)), choose_player=2),
    )
    assert [c.id for c in g.players[0].hand] == [gift]  # no Strike: took the card back

    g = heroes("diaochan", None, None, None)
    g.players[1].gender = "female"
    give(g, 0, "peach")
    (opt,) = g.active_options(g.players[0])
    assert 1 not in opt.candidates


def test_moonlit_rest():
    g = heroes("diaochan", None, None, None)
    drive(g.take_turn(0), pass_all)
    assert drawn(g, "moonlit_rest") == 1  # 2 cards < 3 HP at end phase


@pytest.mark.parametrize("red", [True, False])
def test_five_animals(red):
    g = heroes("hua_tuo", None, None, None)
    g.players[0].hp = 1
    stack_top(g, lambda c: c.is_red == red)
    drive(g.take_turn(0), pass_all)
    assert g.players[0].hp == (2 if red else 1)
    assert drawn(g, "five_animals") == (0 if red else 1)

    g = heroes("hua_tuo", None, None, None)
    drive(g.take_turn(0), pass_all)
    assert not any(e["type"] == "judge" for e in g.log)  # not wounded: no judgment


def test_omen_rejudges_once_per_turn():
    g = heroes(None, "yu_ji", None, None)
    (ind,) = give(g, 3, "indulgence")
    drive(g.use_card(3, ind, [0]), pass_all)
    second = stack_top(g, lambda c: c.suit == Suit.SPADE)
    first_card = stack_top(g, lambda c: c.suit == Suit.HEART)  # would miss
    contexts = []

    def confirm(req):
        contexts.append(req.context)
        return True

    drive(g.phase_judge(g.players[0]), script(confirm=confirm))
    assert contexts[0]["would_hit"] is False and contexts[0]["judge_reason"] == "indulgence"
    assert Phase.PLAY in g.players[0].skip_phases  # the new spade hits
    assert g.cards[first_card] in g.discard_pile and g.cards[second] in g.discard_pile
    assert g.processing == []
    rej = next(e for e in g.log if e["type"] == "rejudge")
    assert rej["old"]["id"] == first_card and rej["card"]["id"] == second
    assert not g.skill_ready(g.players[1], g.find_skill(g.players[1], "omen"))
    assert_cards_conserved(g)


def test_hermit_distance():
    g = heroes("yu_ji", None, None, None)
    assert g.distance(1, 0) == 2 and g.distance(0, 1) == 1
    (s,) = give(g, 1, "strike")
    assert 0 not in g.play_options(g.players[1])[s].candidates


# ---------------------------------------------------------------- bots


def test_bots_use_every_active_skill():
    seen = set()
    for seed in range(120):  # some skills are rare for bots (they only know who the Lord is)
        n = 4 + seed % 5
        g = new_game(n, seed, draft=True)
        play_game(g, [SimpleBot(seed * 10 + i) for i in range(n)])
        assert_cards_conserved(g)
        seen |= {e["skill"] for e in g.log if e["type"] == "skill"}
        seen |= {e["card"]["name"] for e in g.log if e["type"] == "use" and e["card"].get("virtual")}
    assert {"iron_edict", "seize_power", "gather_the_righteous", "east_wind", "allure", "arrows"} <= seen
