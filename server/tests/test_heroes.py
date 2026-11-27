from collections import Counter

import pytest

from bots import SmartBot
from content.heroes import HEROES
from content.standard import new_game
from engine import CardType, ChooseHeroRequest, Convert, Event, Phase, Play, PlayRequest, Suit, Zone
from engine.driver import drive, play_game
from engine.view import log_for, view_for

from .helpers import L, R, S, Y, assert_cards_conserved, equip, give, give_where, pass_all, stack_top

FIVE = (L, Y, R, R, S)


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


def hand_ids(g, seat):
    return [c.id for c in g.players[seat].hand]


def equip_where(g, seat, pred) -> int:
    card = next(c for c in g.draw_pile if pred(c) and g.card_def(c).type == CardType.EQUIPMENT)
    g._raw_move(card.id, Zone.EQUIP, seat)
    return card.id


def skill_option(g, seat, name):
    return next(o for o in g.active_options(g.players[seat]) if o.skill == name)


def start_phase(g):
    return g.trigger(Event.PHASE_START, Phase.START)


# ---------------------------------------------------------------- roster & draft


def test_roster_is_the_standard_set_plus_two_extras():
    assert len({h.id for h in HEROES}) == len(HEROES) == 27
    names = [s.name for h in HEROES for s in h.skills]
    assert len(names) == len(set(names))
    assert all((type(s).__doc__ or "").strip() for h in HEROES for s in h.skills)
    assert sorted(h.id for h in HEROES if h.has_lord_skill) == ["cao_cao", "liu_bei", "sun_quan", "wei_lie"]
    standard = [h for h in HEROES if h.id not in ("wei_lie", "yu_ji")]
    assert Counter(str(h.kingdom) for h in standard) == {"wei": 7, "shu": 7, "wu": 8, "qun": 3}
    assert {h.id for h in HEROES if h.gender == "female"} == {"zhen_ji", "huang_yueying", "da_qiao", "sun_shangxiang", "diaochan"}


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
    assert isinstance(req, PlayRequest) or req.kind == "arrange" or req.kind == "confirm"  # a start-phase skill may ask first
    lord = g.players[g.lord_seat]
    assert (lord.hero, lord.max_hp, lord.hp) == ("liu_bei", 5, 5)
    assert {p.hero for p in g.players} == taken
    assert any(e["type"] == "heroes_revealed" for e in g.log)


def test_draft_deals_only_from_the_hero_pool():
    pool = ["guan_yu", "zhuge_liang", "lu_xun", "zhou_yu", "cao_cao"]  # one lord hero
    for seed in range(20):
        g = new_game(5, seed=seed, draft=True, hero_pool=pool)
        gen = g.run()
        req = next(gen)
        # the lord sees the pool's lord hero plus enough others for a real choice
        assert "cao_cao" in req.options and len(req.options) == 3 and set(req.options) <= set(pool)
        while isinstance(req, ChooseHeroRequest):
            assert req.options and set(req.options) <= set(pool)
            req = gen.send(req.options[0])
        assert sorted(p.hero for p in g.players) == sorted(pool)  # 5 players, 5 heroes: all used

    # no lord heroes in the pool: the lord still gets a choice of 3
    req = next(new_game(4, seed=0, draft=True, hero_pool=["guan_yu", "zhuge_liang", "lu_xun", "zhou_yu"]).run())
    assert len(req.options) == 3
    with pytest.raises(ValueError, match="one hero per player"):
        new_game(5, seed=0, draft=True, hero_pool=pool[:4])
    with pytest.raises(ValueError, match="unknown heroes"):
        new_game(4, seed=0, draft=True, hero_pool=[*pool, "nobody"])


def test_lord_skills_only_work_for_the_lord():
    g = heroes("guan_yu", "cao_cao", None, None)  # Cao Cao isn't the Lord here
    assert "guard_the_throne" not in skill_names(g, 1)
    assert [s["id"] for s in view_for(g, 0)["players"][1]["skills"]] == ["profit_from_loss"]
    g = heroes("sun_quan", None, None, None)
    assert "kinship" in skill_names(g, 0)
    assert view_for(g, 2)["players"][0]["skills"][1]["tags"] == ["locked", "lord"]


# ================================================================= WEI


def test_profit_from_loss_takes_the_damaging_card_if_wanted():
    g = heroes(None, "cao_cao", None, None)
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), script(confirm=True))
    assert hand_ids(g, 1) == [s] and g.players[1].hp == 3

    g = heroes(None, "cao_cao", None, None)
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), pass_all)  # declined
    assert g.players[1].hand == [] and g.cards[s] in g.discard_pile
    assert_cards_conserved(g)


def test_guard_the_throne_wei_allies_dodge_for_the_lord():
    g = heroes("cao_cao", "zhang_liao", "guan_yu", None)
    give(g, 1, "dodge")
    give(g, 2, "dodge")
    (s,) = give(g, 3, "strike")
    asked = []

    def respond(req):
        asked.append((req.seat, req.reason))
        return req.options[0]

    drive(g.use_card(3, s, [0]), script(confirm=True, respond=respond))
    assert g.players[0].hp == 4 and g.players[1].hand == []
    assert asked == [(1, "guard_the_throne")]  # Guan Yu (Shu) is never asked
    assert any(e["type"] == "respond" and e.get("via") == "guard_the_throne" for e in g.log)


def test_tit_for_tat_takes_a_card_from_the_attacker():
    g = heroes(None, "sima_yi", None, None)
    s, _ = give(g, 0, "strike", "peach")
    w = equip(g, 0, "crossbow")
    drive(g.use_card(0, s, [1]), script(confirm=True, choose_card=lambda r: w))
    assert w in hand_ids(g, 1) and g.players[0].equips == []
    assert_cards_conserved(g)


def test_bend_fate_replaces_a_judgment_card():
    g = heroes(None, "sima_yi", None, None)
    (ind,) = give(g, 3, "indulgence")
    drive(g.use_card(3, ind, [0]), pass_all)
    heart = give_where(g, 1, lambda c: c.suit == Suit.HEART)
    stack_top(g, lambda c: c.suit == Suit.SPADE)  # would hit
    seen = []

    def choose(req):
        seen.append(req.context)
        return heart

    drive(g.phase_judge(g.players[0]), script(choose_card=choose))
    assert seen[0]["would_hit"] is True and seen[0]["judge_reason"] == "indulgence" and seen[0]["seat"] == 0
    assert Phase.PLAY not in g.players[0].skip_phases  # the Heart saved the Lord
    assert g.players[1].hand == [] and g.cards[heart] in g.discard_pile and g.processing == []
    assert next(e for e in g.log if e["type"] == "rejudge")["via"] == "bend_fate"
    assert_cards_conserved(g)


def test_blood_for_blood_attacker_discards_or_takes_damage():
    for pick, hp, hand in [("discard_two", 4, 0), ("take_damage", 3, 2)]:
        g = heroes(None, "xiahou_dun", None, None)
        (s,) = give(g, 0, "strike")
        give(g, 0, "dodge", "peach")
        stack_top(g, lambda c: c.suit == Suit.SPADE)
        drive(g.use_card(0, s, [1]), script(confirm=True, choose_option=pick))
        assert (g.players[0].hp, len(g.players[0].hand)) == (hp, hand)

    g = heroes(None, "xiahou_dun", None, None)  # a Heart: nothing happens
    (s,) = give(g, 0, "strike")
    stack_top(g, lambda c: c.suit == Suit.HEART)
    drive(g.use_card(0, s, [1]), script(confirm=True))
    assert g.players[0].hp == 4
    assert_cards_conserved(g)


def test_night_raid_takes_hand_cards_instead_of_drawing():
    g = heroes("zhang_liao", None, None, None)
    (a,) = give(g, 1, "dodge")
    (b,) = give(g, 2, "peach")
    picks = iter([1, 2])
    drive(g.phase_draw(g.players[0]), script(choose_player=lambda r: next(picks), choose_card="hand"))
    assert sorted(hand_ids(g, 0)) == sorted([a, b])
    assert g.players[1].hand == [] and g.players[2].hand == [] and drawn(g, "draw") == 0

    g = heroes("zhang_liao", None, None, None)  # declining: a normal draw
    give(g, 1, "dodge")
    drive(g.phase_draw(g.players[0]), pass_all)
    assert len(g.players[0].hand) == 2


def test_reckless_fury_draws_one_less_for_harder_hits():
    g = heroes("xu_chu", None, None, None)
    drive(g.phase_draw(g.players[0]), script(confirm=True))
    assert len(g.players[0].hand) == 1
    (s,) = give(g, 0, "strike")
    (du,) = give(g, 0, "duel")
    drive(g.use_card(0, s, [1]), pass_all)
    drive(g.use_card(0, du, [2]), pass_all)
    assert g.players[1].hp == 2 and g.players[2].hp == 2
    g.players[0].turn_usage.clear()  # the next turn: back to normal
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [3]), pass_all)
    assert g.players[3].hp == 3


def test_heavens_will_keeps_own_judgment_cards():
    g = heroes("guo_jia", None, None, None)
    equip(g, 0, "eight_trigrams")
    (s,) = give(g, 1, "strike")
    red = stack_top(g, lambda c: c.is_red)
    drive(g.use_card(1, s, [0]), script(confirm=True))
    assert g.players[0].hp == 3 and hand_ids(g, 0) == [red]  # dodged, and kept the card
    assert_cards_conserved(g)


def test_final_stratagem_hands_out_the_top_two_cards():
    g = heroes(None, "guo_jia", None, None)
    top2 = [g.draw_pile[-1].id, g.draw_pile[-2].id]
    shown = []
    gifts = iter([2, 1])

    def choose(req):
        shown.append([c["id"] for c in req.shown])
        return req.options[0]

    drive(g.damage(0, 1, 1), script(choose_card=choose, choose_player=lambda r: next(gifts)))
    assert shown == [top2]  # (the last card needs no choosing)
    assert hand_ids(g, 2) == [top2[0]] and hand_ids(g, 1) == [top2[1]]
    gift = next(e for e in log_for(g, 3) if e["type"] == "give")
    assert "card" not in gift  # nobody else sees what was given

    g = heroes(None, "guo_jia", None, None)  # 2 damage: twice; by default Guo Jia keeps them
    drive(g.damage(0, 1, 2), pass_all)
    assert len(g.players[1].hand) == 4
    assert_cards_conserved(g)


def test_graceful_evasion_black_card_as_dodge():
    g = heroes(None, "zhen_ji", None, None)
    b = give_where(g, 1, lambda c: c.is_black and c.name != "dodge")
    (s,) = give(g, 0, "strike")
    assert g.play_conversions(g.players[1]) == []  # only as a response
    drive(g.use_card(0, s, [1]), script(respond=lambda r: Convert("graceful_evasion", (b,))))
    assert g.players[1].hp == 3 and g.players[1].hand == []
    # the log names the skill, so players see (and hear) it was used
    (resp,) = [e for e in g.log if e["type"] == "respond"]
    assert resp["via"] == "graceful_evasion" and resp["card"]["name"] == "dodge"


def test_rippling_steps_keeps_black_cards_until_a_red():
    g = heroes("zhen_ji", None, None, None)
    red = stack_top(g, lambda c: c.is_red)
    b2 = stack_top(g, lambda c: c.is_black)
    b1 = stack_top(g, lambda c: c.is_black)
    drive(start_phase(g), script(confirm=True))
    assert hand_ids(g, 0) == [b1, b2] and g.cards[red] in g.discard_pile
    assert_cards_conserved(g)


# ================================================================= SHU


def test_open_hand_gives_cards_and_heals_once():
    g = heroes("liu_bei", None, None, None)
    g.players[0].hp = 2
    a, b, c = give(g, 0, "dodge", "dodge", "strike")
    drive(g.phase_play(g.players[0]), script(
        Play(skill="open_hand", cards=(a,), targets=(1,)),
        Play(skill="open_hand", cards=(b,), targets=(2,)),  # 2 given in all: heal
        Play(skill="open_hand", cards=(c,), targets=(1,)),  # no second heal
    ))
    assert g.players[0].hp == 3
    assert hand_ids(g, 1) == [a, c] and hand_ids(g, 2) == [b]


def test_call_to_arms_shu_allies_strike_for_the_lord():
    g = heroes("liu_bei", "guan_yu", None, None)
    give(g, 1, "strike")
    assert skill_option(g, 0, "call_to_arms").candidates == (1, 3)  # Liu Bei's own attack range
    drive(g.phase_play(g.players[0]), script(Play(skill="call_to_arms", targets=(3,)), respond=first))
    assert g.players[3].hp == 3 and g.players[1].hand == [] and g.players[0].strikes_used == 1

    g = heroes("liu_bei", "zhao_yun", None, None)  # in a Duel
    give(g, 1, "strike")
    (du,) = give(g, 2, "duel")
    drive(g.use_card(2, du, [0]), script(confirm=True, respond=first))
    assert g.players[2].hp == 3 and g.players[0].hp == 4

    g = heroes("liu_bei", "guan_yu", None, None)  # nobody answers: not offered again this turn
    drive(g.phase_play(g.players[0]), script(Play(skill="call_to_arms", targets=(3,))))
    assert g.players[3].hp == 4
    assert "call_to_arms" not in [o.skill for o in g.active_options(g.players[0])]


def test_crimson_blade_red_cards_and_equipment_as_strikes():
    g = heroes("guan_yu", None, None, None)
    h = give_where(g, 0, lambda c: c.is_red and c.name != "strike")
    eq = equip_where(g, 0, lambda c: c.is_red)
    (conv,) = g.play_conversions(g.players[0])
    assert conv.skill == "crimson_blade" and set(conv.cards) == {h, eq}
    drive(g.phase_play(g.players[0]), script(Play(skill="crimson_blade", cards=(eq,), targets=(1,))))
    assert g.players[1].hp == 3 and g.players[0].equips == []
    assert_cards_conserved(g)


def test_endless_onslaught_strikes_freely():
    g = heroes("zhang_fei", None, None, None)
    a, b, c = give(g, 0, "strike", "strike", "strike")
    drive(g.phase_play(g.players[0]), script(Play(a, (1,)), Play(b, (1,)), Play(c, (3,))))
    assert g.players[1].hp == 2 and g.players[3].hp == 3


def test_star_chart_rearranges_the_top_of_the_deck():
    g = heroes("zhuge_liang", None, None, None)
    top4 = [c.id for c in reversed(g.draw_pile[-4:])]  # top first; 4 living players
    seen = []

    def arrange(req):
        seen.append(req)
        return ((top4[2], top4[0]), (top4[1], top4[3]))

    drive(start_phase(g), script(arrange=arrange))
    assert seen[0].options == top4 and [c["id"] for c in seen[0].cards] == top4
    assert [c.id for c in reversed(g.draw_pile[-2:])] == [top4[2], top4[0]]
    assert [c.id for c in g.draw_pile[:2]] == [top4[3], top4[1]]  # the last one at the very bottom
    assert all("cards" not in e for e in log_for(g, 1) if e["type"] == "arrange")
    assert_cards_conserved(g)


def test_nothing_to_hide_with_an_empty_hand():
    g = heroes(None, "zhuge_liang", None, None)
    s, du = give(g, 0, "strike", "duel")
    opts = g.play_options(g.players[0])
    assert 1 not in opts[s].candidates and 1 not in opts[du].candidates
    give(g, 1, "dodge")
    opts = g.play_options(g.players[0])
    assert 1 in opts[s].candidates and 1 in opts[du].candidates


def test_unwavering_spear_swaps_strike_and_dodge():
    g = heroes("zhao_yun", None, None, None)
    (d,) = give(g, 0, "dodge")
    assert [(c.skill, c.as_name, c.cards) for c in g.play_conversions(g.players[0])] == [("unwavering_spear", "strike", (d,))]
    drive(g.phase_play(g.players[0]), script(Play(skill="unwavering_spear", cards=(d,), targets=(1,))))
    assert g.players[1].hp == 3

    g = heroes(None, "zhao_yun", None, None)
    (st,) = give(g, 1, "strike")
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), script(respond=lambda r: Convert("unwavering_spear", (st,))))
    assert g.players[1].hp == 4 and g.players[1].hand == []


def test_swift_rider_and_headlong_charge():
    for judge_red, hp in [(True, 3), (False, 4)]:
        g = heroes("ma_chao", None, None, None, None, roles=FIVE)
        assert g.distance(0, 2) == 1  # two seats away, -1
        (s,) = give(g, 0, "strike")
        give(g, 2, "dodge")
        stack_top(g, lambda c: c.is_red == judge_red)
        drive(g.use_card(0, s, [2]), script(confirm=True, respond=first))
        assert g.players[2].hp == hp  # red: the Dodge couldn't be played


def test_ingenuity_and_boundless_wit():
    g = heroes("huang_yueying", None, None, None, None, roles=FIVE)
    sn, ex = give(g, 0, "snatch", "ex_nihilo")
    give(g, 2, "dodge")
    assert 2 in g.play_options(g.players[0])[sn].candidates  # two seats away: fine for her
    drive(g.use_card(0, ex, []), pass_all)
    assert drawn(g, "ingenuity") == 1 and drawn(g, "ex_nihilo") == 2
    (ind,) = give(g, 0, "indulgence")
    drive(g.use_card(0, ind, [1]), pass_all)
    assert drawn(g, "ingenuity") == 1  # delayed tricks don't count


# ================================================================= WU


def test_weigh_options_discards_and_draws_the_same_number():
    g = heroes("sun_quan", None, None, None)
    a, b = give(g, 0, "strike", "dodge")
    w = equip(g, 0, "crossbow")
    opt = skill_option(g, 0, "weigh_options")
    assert set(opt.cards) == {a, b, w} and opt.max_cards == 3
    drive(g.phase_play(g.players[0]), script(Play(skill="weigh_options", cards=(a, w))))
    assert len(g.players[0].hand) == 3 and g.players[0].equips == []
    assert "weigh_options" not in [o.skill for o in g.active_options(g.players[0])]  # once per turn


def test_kinship_wu_peach_heals_the_lord_extra():
    g = heroes("sun_quan", "lu_xun", "guan_yu", None)
    give(g, 1, "peach")
    give(g, 2, "peach")
    g.players[0].hp = 1
    drive(g.damage(3, 0, 1), script(respond=first))
    assert g.players[0].hp == 2 and len(g.players[2].hand) == 1  # Lu Xun's Peach was enough

    g = heroes("sun_quan", "guan_yu", None, None)  # a Shu Peach: the usual 1 HP
    give(g, 1, "peach")
    g.players[0].hp = 1
    drive(g.damage(3, 0, 1), script(respond=first))
    assert g.players[0].hp == 1


def test_pirates_raid_black_cards_as_dismantle():
    g = heroes("gan_ning", None, None, None)
    b = give_where(g, 0, lambda c: c.is_black)
    (d,) = give(g, 1, "dodge")
    drive(g.phase_play(g.players[0]), script(Play(skill="pirates_raid", cards=(b,), targets=(1,)), choose_card="hand"))
    assert g.players[1].hand == [] and g.cards[d] in g.discard_pile


def test_bide_time_skips_discard_without_strikes():
    g = heroes("lu_meng", None, None, None)
    give(g, 0, "dodge", "dodge", "dodge", "dodge", "dodge", "peach")
    drive(g.take_turn(0), pass_all)  # plays nothing
    assert len(g.players[0].hand) == 8  # drew 2, kept everything

    g = heroes("lu_meng", None, None, None)
    (s,) = give(g, 0, "strike")
    give(g, 0, "dodge", "dodge", "dodge", "dodge", "dodge")
    drive(g.take_turn(0), script(Play(s, (1,))))
    assert len(g.players[0].hand) == 4  # used a Strike: discards down to its HP


def test_bitter_gambit_loses_hp_and_draws_two():
    g = heroes("huang_gai", None, None, None)
    drive(g.phase_play(g.players[0]), script(Play(skill="bitter_gambit"), Play(skill="bitter_gambit")))
    assert g.players[0].hp == 2 and len(g.players[0].hand) == 4
    assert not any(e["type"] == "damage" for e in g.log)  # losing HP isn't damage

    g = heroes(None, "huang_gai", None, None)  # at 1 HP: dying, saved, then draws
    g.players[1].hp = 1
    give(g, 1, "peach")
    drive(g.phase_play(g.players[1]), script(Play(skill="bitter_gambit"), respond=first))
    assert g.players[1].hp == 1 and len(g.players[1].hand) == 2


def test_dashing_draws_three():
    g = heroes("zhou_yu", None, None, None)
    drive(g.phase_draw(g.players[0]), pass_all)
    assert len(g.players[0].hand) == 3


@pytest.mark.parametrize("named, hp", [("heart", 3), ("spade", 4)])
def test_false_letter_wrong_suit_hurts(named, hp):
    g = heroes("zhou_yu", None, None, None)
    sp = give_where(g, 0, lambda c: c.suit == Suit.SPADE)
    drive(
        g.phase_play(g.players[0]),
        script(Play(skill="false_letter", targets=(1,)), choose_option=named, discard=[sp]),
    )
    assert hand_ids(g, 1) == [sp] and g.players[1].hp == hp


def test_false_letter_zhou_yu_picks_the_card():
    """After the suit is named, Zhou Yu chooses which hand card to hand over."""
    g = heroes("zhou_yu", None, None, None)
    sp = give_where(g, 0, lambda c: c.suit == Suit.SPADE)
    ht = give_where(g, 0, lambda c: c.suit == Suit.HEART)
    asked = []

    def pick(req):
        asked.append(req)
        return [ht]

    drive(
        g.phase_play(g.players[0]),
        script(Play(skill="false_letter", targets=(1,)), choose_option="spade", discard=pick),
    )
    (req,) = asked
    assert req.seat == 0 and req.about == 1 and req.context == {"suit": "spade"} and set(req.options) == {sp, ht}
    assert hand_ids(g, 0) == [sp] and hand_ids(g, 1) == [ht] and g.players[1].hp == 3


def test_captivate_diamond_as_indulgence():
    g = heroes("da_qiao", None, None, None)
    dm = give_where(g, 0, lambda c: c.suit == Suit.DIAMOND and c.name != "indulgence")
    drive(g.phase_play(g.players[0]), script(Play(skill="captivate", cards=(dm,), targets=(1,))))
    (use,) = [e for e in g.log if e["type"] == "use"]
    assert use["via"] == "captivate" and use["card"]["name"] == "indulgence"
    t = g.players[1]
    assert [c.id for c in t.judge] == [dm] and g.has_in_judge(t, "indulgence")
    shown = view_for(g, 2)["players"][1]["judge"][0]
    assert shown["name"] == "indulgence" and shown["real"] == g.cards[dm].name
    stack_top(g, lambda c: c.suit == Suit.CLUB)
    drive(g.phase_judge(t), pass_all)
    assert Phase.PLAY in t.skip_phases and t.judge == [] and g.cards[dm] in g.discard_pile
    assert dm not in g.judge_as
    assert_cards_conserved(g)

    g = heroes("da_qiao", None, None, None)  # dismantled away, it's an ordinary card again
    dm = give_where(g, 0, lambda c: c.suit == Suit.DIAMOND and c.name != "indulgence")
    drive(g.phase_play(g.players[0]), script(Play(skill="captivate", cards=(dm,), targets=(1,))))
    (di,) = give(g, 2, "dismantle")
    drive(g.use_card(2, di, [1]), script(choose_card=lambda r: dm))
    assert dm not in g.judge_as and not g.has_in_judge(g.players[1], "indulgence")


def test_deflect_passes_a_strike_on():
    g = heroes(None, "da_qiao", None, None)
    (s,) = give(g, 0, "strike")
    (d,) = give(g, 1, "dodge")
    offered = []

    def choose(req):
        offered.append(req.options)
        return 2

    drive(g.use_card(0, s, [1]), script(choose_player=choose, discard=lambda r: [d]))
    assert offered == [[2]]  # in her range, never the Strike's user
    assert g.players[1].hp == 3 and g.players[2].hp == 3 and g.players[1].hand == []
    redirect = next(e for e in g.log if e["type"] == "redirect")
    assert (redirect["seat"], redirect["target"]) == (1, 2)


def test_low_profile_blocks_snatch_and_indulgence():
    g = heroes(None, "lu_xun", None, None)
    give(g, 1, "dodge")
    give(g, 3, "dodge")  # someone else Snatch can reach
    sn, ind, du = give(g, 0, "snatch", "indulgence", "duel")
    opts = g.play_options(g.players[0])
    assert opts[sn].candidates == (3,) and 1 not in opts[ind].candidates and 1 in opts[du].candidates


def test_endless_supply_draws_on_losing_the_last_hand_card():
    g = heroes(None, "lu_xun", None, None)
    give(g, 1, "dodge")
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), script(respond=first))
    assert drawn(g, "endless_supply") == 1 and len(g.players[1].hand) == 1


def test_wedding_vow_heals_both():
    g = heroes("sun_shangxiang", "guan_yu", "diaochan", None)
    for p in g.players:
        p.hp = 2
    a, b = give(g, 0, "strike", "dodge")
    assert set(skill_option(g, 0, "wedding_vow").candidates) == {1, 3}  # wounded men only
    drive(g.phase_play(g.players[0]), script(Play(skill="wedding_vow", cards=(a, b), targets=(1,))))
    assert g.players[0].hp == 3 and g.players[1].hp == 3


def test_spare_arms_draws_two_per_lost_equipment():
    g = heroes(None, "sun_shangxiang", None, None)
    equip(g, 1, "plus_horse")
    (di,) = give(g, 0, "dismantle")
    drive(g.use_card(0, di, [1]), script(choose_card=first))
    assert drawn(g, "spare_arms") == 2

    equip(g, 1, "crossbow")  # replacing equipment counts too
    (w,) = give(g, 1, "piercing_sword")
    drive(g.use_card(1, w, []), pass_all)
    assert drawn(g, "spare_arms") == 4


# ================================================================= QUN


def test_emergency_cure_red_cards_as_peach_outside_own_turn():
    g = heroes("guan_yu", "hua_tuo", None, None)  # seat 0's turn
    h = give_where(g, 1, lambda c: c.is_red and c.name != "peach")
    g.players[3].hp = 1
    drive(g.damage(0, 3, 1), script(respond=lambda r: Convert("emergency_cure", (h,)) if r.conversions else None))
    assert g.players[3].hp == 1 and g.cards[h] in g.discard_pile
    give_where(g, 1, lambda c: c.is_red and c.name != "peach")
    g.current = 1  # on Hua Tuo's own turn it isn't offered
    assert g.response_conversions(g.players[1], "peach") == []


def test_healing_herbs_heals_anyone_wounded():
    g = heroes("hua_tuo", None, None, None)
    g.players[0].hp, g.players[2].hp = 2, 3
    (a,) = give(g, 0, "strike")
    assert set(skill_option(g, 0, "healing_herbs").candidates) == {0, 2}
    drive(g.phase_play(g.players[0]), script(Play(skill="healing_herbs", cards=(a,), targets=(2,))))
    assert g.players[2].hp == 4


def test_unmatched_might_needs_two_dodges_and_two_strikes():
    for dodges, hp in [(1, 3), (2, 4)]:
        g = heroes("lu_bu", None, None, None)
        (s,) = give(g, 0, "strike")
        give(g, 1, *["dodge"] * dodges)
        drive(g.use_card(0, s, [1]), script(respond=first))
        assert g.players[1].hp == hp and g.players[1].hand == []  # one Dodge isn't enough

    g = heroes("lu_bu", None, None, None)  # Duel: the other side needs 2 Strikes each round
    (du,) = give(g, 0, "duel")
    give(g, 1, "strike")
    drive(g.use_card(0, du, [1]), script(respond=first))
    assert g.players[1].hp == 3 and g.players[1].hand == []

    g = heroes("lu_bu", None, None, None)  # ...whoever started it
    (du,) = give(g, 1, "duel")
    give(g, 0, "strike")
    give(g, 1, "strike", "strike")
    drive(g.use_card(1, du, [0]), script(respond=first))
    assert g.players[0].hp == 3 and g.players[1].hp == 4 and g.players[1].hand == []


def test_rivalry_sets_two_men_to_duel_unnullifiably():
    g = heroes("diaochan", "guan_yu", "lu_bu", "da_qiao")
    (c,) = give(g, 0, "dodge")
    give(g, 3, "nullify")  # can't help
    assert set(skill_option(g, 0, "rivalry").candidates) == {1, 2}
    drive(g.phase_play(g.players[0]), script(Play(skill="rivalry", cards=(c,), targets=(1, 2)), respond=first))
    assert g.players[2].hp == 3 and g.players[1].hp == 4  # Lü Bu had no Strike
    assert not any(e["type"] == "nullify" for e in g.log)
    duel = next(e for e in g.log if e["type"] == "use" and e["card"]["name"] == "duel")
    assert duel["seat"] == 1 and duel["targets"] == [2]


def test_evening_grace_draws_at_end_phase():
    g = heroes("diaochan", None, None, None)
    drive(g.trigger(Event.PHASE_START, Phase.END), pass_all)
    assert drawn(g, "evening_grace") == 1


# ================================================================= extras


def test_spoils_of_war_takes_the_damaging_card():
    g = heroes(None, "wei_lie", None, None)
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), pass_all)
    assert hand_ids(g, 1) == [s] and g.players[1].hp == 3
    assert_cards_conserved(g)


def test_spoils_of_war_takes_all_converted_cards_and_area_tricks():
    g = heroes(None, "wei_lie", None, None)
    equip(g, 0, "serpent_spear")
    a, b = give(g, 0, "peach", "dodge")
    drive(g.phase_play(g.players[0]), script(Play(skill="serpent_spear", cards=(a, b), targets=(1,))))
    assert set(hand_ids(g, 1)) == {a, b}

    g = heroes(None, None, "wei_lie", None)
    (bb,) = give(g, 0, "barbarians")
    drive(g.use_card(0, bb, []), pass_all)
    assert hand_ids(g, 2) == [bb]
    assert [p.hp for p in g.players] == [4, 3, 3, 3]  # the others still got hit
    assert_cards_conserved(g)


def test_spoils_of_war_draws_when_no_card_dealt_it():
    g = heroes(None, "wei_lie", None, None)
    drive(g.damage(None, 1, 1), pass_all)
    assert len(g.players[1].hand) == 1 and drawn(g, "spoils_of_war") == 1


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
    assert not g.skill_ready(g.players[1], g.find_skill(g.players[1], "omen"))
    assert_cards_conserved(g)


def test_hermit_distance():
    g = heroes("yu_ji", None, None, None)
    assert g.distance(1, 0) == 2 and g.distance(0, 1) == 1
    (s,) = give(g, 1, "strike")
    assert 0 not in g.play_options(g.players[1])[s].candidates


# ---------------------------------------------------------------- bots


def test_bots_use_every_active_skill_and_conversion():
    seen = set()
    for seed in range(80):
        n = 4 + seed % 5
        g = new_game(n, seed, draft=True)
        play_game(g, [SmartBot(seed * 10 + i) for i in range(n)])
        assert_cards_conserved(g)
        seen |= {e["skill"] for e in g.log if e["type"] == "skill"}
        seen |= {e["card"]["name"] for e in g.log if e["type"] == "use" and e["card"].get("virtual")}
    active = {"open_hand", "call_to_arms", "weigh_options", "bitter_gambit", "false_letter",
              "wedding_vow", "healing_herbs", "rivalry"}
    assert active <= seen, active - seen
    assert {"indulgence", "strike"} <= seen  # converted cards


def test_bot_uses_a_black_card_as_dismantle_on_an_enemy():
    g = heroes("gan_ning", None, "zhao_yun", None)  # Gan Ning is the Lord; seat 2 the Rebel
    (s,) = give(g, 2, "strike")
    drive(g.use_card(2, s, [0]), pass_all)  # ...who showed it by attacking the Lord
    b = give_where(g, 0, lambda c: c.is_black and c.name not in ("nullify", "dismantle"))
    equip(g, 2, "eight_trigrams")
    play = SmartBot(1)(g, PlayRequest(seat=0, options={}, conversions=g.play_conversions(g.players[0]), skills=[]))
    assert play == Play(skill="pirates_raid", cards=(b,), targets=(2,))
