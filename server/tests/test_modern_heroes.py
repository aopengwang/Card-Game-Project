"""The six modern heroes designed at our table: Chairman, Marks, Donald, Diddy, Yilong Ma, Mr. Liang."""
import pytest

from bots import SimpleBot, SmartBot
from content.heroes import MODERN
from content.names import content_info
from content.standard import STANDARD, new_game
from engine import Event, GameOver, Phase, Play, Suit, Zone
from engine.driver import drive, play_game
from engine.sandbox import set_tokens
from engine.view import view_for

from .helpers import L, R, S, Y, assert_cards_conserved, equip, give, give_where, pass_all, stack_top
from .test_heroes import drawn, hand_ids, heroes, script, skill_names, skill_option

FIVE = (L, Y, R, R, S)


def active(g, seat):
    return [o.skill for o in g.active_options(g.players[seat])]


# ================================================================= The Chairman


def test_aura_farmer_gains_an_aura_token_per_turn_without_strikes_up_to_four():
    g = heroes("chairman", None, None, None)
    for n in (1, 2, 3, 4, 4):
        drive(g.take_turn(0), pass_all)
        assert g.players[0].tokens.get("aura") == n
    assert view_for(g, 2)["players"][0]["tokens"] == {"aura": 4}  # everyone sees the tokens
    farmed = [e for e in g.log if e["type"] == "skill" and e["skill"] == "aura_farmer"]
    assert len(farmed) == 4  # (logged each time it fires: the client shows its aura)

    g = heroes("chairman", None, None, None)
    (s,) = give(g, 0, "strike")
    drive(g.take_turn(0), script(Play(s, (1,))))
    assert "aura" not in g.players[0].tokens


def test_do_nothing_win_spends_an_aura_token_to_keep_one_of_the_top_two():
    g = heroes("chairman", None, None, None)
    assert "do_nothing_win" not in active(g, 0)  # no tokens yet
    g.players[0].tokens["aura"] = 1
    a = stack_top(g, lambda c: c.name == "peach")
    b = stack_top(g, lambda c: c.name == "strike")  # b is now on top
    asked = []

    def pick(req):
        asked.append(req)
        return a

    drive(g.phase_play(g.players[0]), script(Play(skill="do_nothing_win"), choose_card=pick))
    (req,) = asked
    assert req.options == [b, a] and [c["id"] for c in req.shown] == [b, a]
    assert hand_ids(g, 0) == [a] and g.cards[b] in g.discard_pile
    assert "aura" not in g.players[0].tokens and "do_nothing_win" not in active(g, 0)
    assert_cards_conserved(g)


def test_whats_up_beijing_shows_the_hand_and_bends_distances_until_the_next_turn():
    g = heroes("chairman", None, None, None, None, roles=FIVE)
    give(g, 0, "dodge")
    assert g.distance(0, 2) == 2
    drive(g.phase_play(g.players[0]), script(Play(skill="whats_up_beijing")))
    shown = next(e for e in g.log if e["type"] == "show_hand")
    assert [c["name"] for c in shown["cards"]] == ["dodge"]
    assert g.distance(0, 2) == 1 and g.distance(2, 0) == 101 and g.distance(1, 0) == 100
    assert view_for(g, 1)["players"][0]["tokens"] == {"beijing": 1}
    assert "whats_up_beijing" in view_for(g, 1)["players"][0]["spent"]
    assert "whats_up_beijing" not in active(g, 0)  # once per game
    drive(g.trigger(Event.TURN_START, g.players[0]), pass_all)  # it wears off
    assert g.distance(0, 2) == 2 and g.players[0].tokens == {}


def test_whats_up_beijing_needs_a_card_free_turn_and_the_lord():
    g = heroes("chairman", None, None, None)
    assert "whats_up_beijing" in active(g, 0)
    g.players[0].turn_usage["_cards_used"] = 1
    assert "whats_up_beijing" not in active(g, 0)
    g = heroes(None, "chairman", None, None)
    assert "whats_up_beijing" not in skill_names(g, 1)


# ================================================================= Marks


def test_communism_draws_when_others_gain_cards_while_short_of_hp():
    g = heroes(None, "marks", None, None)  # 3 HP
    drive(g.draw(0, 2), pass_all)
    assert len(g.players[1].hand) == 1  # once per gain, however many cards it was
    drive(g.draw(2, 1), pass_all)
    drive(g.draw(3, 1), pass_all)
    assert len(g.players[1].hand) == 3
    drive(g.draw(2, 1), pass_all)
    assert len(g.players[1].hand) == 3  # not below HP any more
    g.players[1].hp = 4
    g.players[1].max_hp = 4
    drive(g.draw(0, 1), pass_all)
    assert len(g.players[1].hand) == 4
    assert [e for e in g.log if e["type"] == "skill" and e["skill"] == "communism"]
    assert_cards_conserved(g)


def test_communism_counts_any_gain_but_not_the_deal_or_his_own():
    g = heroes(None, "marks", None, None)
    drive(g.draw(0, 4, reason="deal"), pass_all)
    assert g.players[1].hand == []  # the opening deal
    drive(g.draw(1, 1), pass_all)
    assert len(g.players[1].hand) == 1  # his own draw sets nothing off
    horse = equip(g, 2, "plus_horse")
    drive(g.move_cards([horse], Zone.HAND, 2, reason="test"), pass_all)
    assert len(g.players[1].hand) == 1  # taking back your own card isn't gaining one
    drive(g.move_cards([horse], Zone.HAND, 3, reason="test"), pass_all)
    assert len(g.players[1].hand) == 2  # taken from another player
    assert_cards_conserved(g)


def test_a_draw_set_off_by_deepseek_leaves_the_revealed_cards_alone():
    g = heroes("mr_liang", "marks", None, None)
    (c,) = give(g, 0, "dodge")
    a, b, d = (stack_top(g, lambda x, n=n: x.name == n) for n in ("peach", "strike", "duel"))
    drive(g.phase_play(g.players[0]), script(Play(skill="deepseek", cards=(c,)), choose_card=lambda r: b))
    assert hand_ids(g, 0) == [b] and len(g.players[1].hand) == 1
    assert {g.draw_pile[0].id, g.draw_pile[1].id} == {a, d} and not g.held
    assert_cards_conserved(g)


def test_sharing_the_most_gives_the_fewest_a_random_card():
    g = heroes("marks", None, None, None)
    give(g, 1, "strike", "dodge", "peach")
    give(g, 2, "strike")
    opt = skill_option(g, 0, "sharing")
    assert set(opt.candidates) == {0, 1, 3}  # seat 1 has the most; Marks and seat 3 have none
    assert g.check_skill_use(g.players[0], "sharing", [], [3, 0]) is not None  # the giver must have the most
    assert g.check_skill_use(g.players[0], "sharing", [], [1, 2]) is not None  # the taker must have the fewest
    drive(g.phase_play(g.players[0]), script(Play(skill="sharing", targets=(1, 3))))
    assert len(g.players[1].hand) == 2 and len(g.players[3].hand) == 1
    assert "sharing" not in active(g, 0)


# ================================================================= Donald


def test_tariff_cashed_in_as_two_discards():
    g = heroes("donald", None, None, None)
    a, b = give(g, 0, "dodge", "strike")
    drive(g.phase_play(g.players[0]), script(Play(skill="tariffs", targets=(1,))))
    assert g.players[1].tokens == {"tariff": 1}
    peach, kept = give(g, 1, "peach", "dodge")
    horse = equip(g, 1, "plus_horse")
    paid = []

    def discard(req):
        paid.append((req.seat, req.count, req.reason))
        return [a] if req.seat == 0 else [peach, horse]  # Donald pays one, then they pay two

    drive(
        g.trigger(Event.TURN_START, g.players[1]),
        script(confirm=True, discard=discard, choose_option="tariff_discard"),
    )
    assert paid == [(0, 1, "tariffs"), (1, 2, "tariff_penalty")]
    assert hand_ids(g, 1) == [kept] and g.players[1].equips == [] and g.players[1].judge == []
    assert hand_ids(g, 0) == [b] and g.players[1].tokens == {}
    assert_cards_conserved(g)


def test_tariff_offers_two_discards_only_with_two_cards():
    g = heroes("donald", None, None, None)
    a, _ = give(g, 0, "dodge", "strike")
    drive(g.phase_play(g.players[0]), script(Play(skill="tariffs", targets=(1,))))
    give(g, 1, "peach")
    asked = []

    def choose(req):
        asked.append(req.choices)
        return "tariff_give"

    drive(g.trigger(Event.TURN_START, g.players[1]), script(confirm=True, discard=[a], choose_option=choose))
    assert asked == [["tariff_give"]]


def test_tariff_cashed_in_as_a_random_card():
    g = heroes("donald", None, None, None)
    a, b = give(g, 0, "dodge", "strike")
    drive(g.phase_play(g.players[0]), script(Play(skill="tariffs", targets=(2,))))
    p, q = give(g, 2, "peach", "peach")
    asked = []

    def choose(req):
        asked.append(req.choices)
        return "tariff_give"

    drive(g.trigger(Event.TURN_START, g.players[2]), script(confirm=True, discard=[a], choose_option=choose))
    assert asked == [["tariff_give", "tariff_discard"]]
    assert len(g.players[2].hand) == 1 and set(hand_ids(g, 0)) in ({b, p}, {b, q})


def test_a_declined_tariff_stays():
    g = heroes("donald", None, None, None)
    give(g, 0, "dodge")
    drive(g.phase_play(g.players[0]), script(Play(skill="tariffs", targets=(1,))))
    give(g, 1, "peach")
    drive(g.trigger(Event.TURN_START, g.players[1]), script(confirm=False))
    assert g.players[1].tokens == {"tariff": 1} and len(g.players[0].hand) == 1


def test_dodged_a_bullet_once_per_game_for_the_lord():
    g = heroes("donald", None, None, None)
    g.players[0].hp = 1
    drive(g.damage(1, 0, 2), script(confirm=True))
    assert g.players[0].alive and g.players[0].hp == 1 and drawn(g, "dodged_a_bullet") == 1
    with pytest.raises(GameOver):  # spent: this time the Lord falls
        drive(g.damage(1, 0, 1), script(confirm=True))

    g = heroes(None, "donald", None, None)  # not the Lord: no lord skill
    g.players[1].hp = 1
    drive(g.damage(2, 1, 1), script(confirm=True))
    assert not g.players[1].alive


# ================================================================= Diddy


def test_baby_oil_makes_a_player_slippery_and_a_black_judgment_voids_their_card():
    g = heroes("diddy", None, None, None)
    (c,) = give(g, 0, "dodge")
    drive(g.phase_play(g.players[0]), script(Play(skill="baby_oil", cards=(c,), targets=(1,))))
    assert g.players[1].tokens == {"slippery": 1} and "slippery" in skill_names(g, 1)
    g.current = 1  # seat 1's turn: their Strike slips
    (s,) = give(g, 1, "strike")
    stack_top(g, lambda c: c.is_black)
    drive(g.use_card(1, s, [2]), pass_all)
    assert g.players[2].hp == 4 and g.cards[s] in g.discard_pile
    assert g.players[1].tokens == {} and g.players[1].strikes_used == 1
    assert any(e["type"] == "voided" and e["reason"] == "slippery" for e in g.log)
    assert_cards_conserved(g)


def test_slippery_red_judgment_keeps_the_marker_until_the_turn_ends():
    g = heroes("diddy", None, None, None)
    g.players[1].tokens["slippery"] = 1
    (x,) = give(g, 1, "ex_nihilo")
    g.current = 0  # not their turn: no judgment
    drive(g.use_card(1, x, []), pass_all)
    assert drawn(g, "ex_nihilo") == 2 and not any(e["type"] == "judge" for e in g.log)
    g.current = 1
    (x,) = give(g, 1, "ex_nihilo")
    stack_top(g, lambda c: c.is_red)
    drive(g.use_card(1, x, []), pass_all)
    assert drawn(g, "ex_nihilo") == 4 and g.players[1].tokens == {"slippery": 1}
    drive(g.trigger(Event.TURN_END, g.players[1]), pass_all)
    assert g.players[1].tokens == {}


def test_baby_oil_marks_whoever_hurts_diddy():
    g = heroes(None, "diddy", None, None)
    (s,) = give(g, 0, "strike")
    drive(g.use_card(0, s, [1]), script(confirm=True))
    assert g.players[0].tokens == {"slippery": 1}


# ================================================================= Yilong Ma


def test_live_by_the_sword_turns_weapons_into_peaches_and_duels():
    g = heroes("yilong_ma", None, None, None)
    sword = equip(g, 0, "crossbow")
    (spare,) = give(g, 0, "stone_axe")
    give(g, 0, "dodge")  # not a weapon
    me = g.players[0]
    offered = [(c.as_name, set(c.cards)) for c in g.play_conversions(me) if c.skill == "live_by_the_sword"]
    assert offered == [("duel", {sword, spare})]  # at full HP there's no Peach to use
    me.hp -= 1
    offered = [c.as_name for c in g.play_conversions(me) if c.skill == "live_by_the_sword"]
    assert offered == ["peach", "duel"]
    drive(
        g.phase_play(me),
        script(
            Play(skill="live_by_the_sword", cards=(spare,), as_name="peach"),
            Play(skill="live_by_the_sword", cards=(sword,), targets=(1,), as_name="duel"),
        ),
    )
    uses = [(e["card"]["name"], e["via"]) for e in g.log if e["type"] == "use"]
    assert uses == [("peach", "live_by_the_sword"), ("duel", "live_by_the_sword")]
    assert me.hp == me.max_hp and g.players[1].hp == 3 and me.equips == []
    assert_cards_conserved(g)


def test_live_by_the_sword_saves_the_dying():
    g = heroes("yilong_ma", None, None, None)
    (w,) = give(g, 0, "crossbow")
    assert [c.cards for c in g.response_conversions(g.players[0], "peach")] == [(w,)]
    assert g.response_conversions(g.players[0], "strike") == []


def test_spacex_launches_straight_away_for_the_rest_of_the_play_phase():
    g = heroes("yilong_ma", None, None, None)
    equip(g, 0, "plus_horse")
    equip(g, 0, "eight_trigrams")
    s1, s2, s3 = give(g, 0, "strike", "strike", "strike")
    g.players[1].max_hp = g.players[1].hp = 10
    launched = []
    plays = script(Play(s1, (1,)), Play(s2, (1,)), Play(s3, (1,)), None, confirm=True)

    def answer(req):
        if req.kind == "play":
            launched.append(g.players[0].tokens.get("launch"))
        return plays(req)

    drive(g.take_turn(0), answer)
    hits = [e["amount"] for e in g.log if e["type"] == "damage"]
    assert hits == [2, 2, 2]  # +1 damage and a raised Strike limit, in the same play phase
    assert launched and all(n == 1 for n in launched)  # marked Launched the whole phase
    assert g.players[0].equips == [] and "spacex" not in g.players[0].marks  # not once per game
    assert sum(1 for e in g.log if e["type"] == "phase" and e["phase"] == "play") == 1  # no extra phase
    assert g.players[0].tokens == {}  # touched down at the end of the phase
    assert_cards_conserved(g)


@pytest.mark.parametrize("gear", [2, 3, 4])
def test_spacex_raises_the_strike_limit_by_the_equipment_discarded(gear):
    g = heroes("yilong_ma", None, None, None)
    for name in ("plus_horse", "eight_trigrams", "minus_horse", "crossbow")[:gear]:
        equip(g, 0, name)
    strikes = give(g, 0, *["strike"] * 6)
    g.players[1].max_hp = g.players[1].hp = 30
    used = []

    def play(req):  # strike for as long as the game lets us
        s = next((i for i in req.options if i in strikes), None)
        if s is None:
            return None
        used.append(s)
        return Play(s, (1,))

    def answer(req):
        if req.kind == "play":
            return play(req)
        return True if req.kind == "confirm" else req.default()

    drive(g.take_turn(0), answer)
    assert len(used) == 1 + gear  # the usual 1, plus one per card discarded
    assert [e["count"] for e in g.log if e["type"] == "draw" and e["reason"] == "spacex"] == [gear]  # and drew as many


def test_spacex_once_per_turn_and_again_on_a_later_turn():
    g = heroes("yilong_ma", None, None, None)
    equip(g, 0, "plus_horse")
    equip(g, 0, "eight_trigrams")
    asked = []

    def answer(req):
        if req.kind == "confirm" and req.reason == "spacex":
            asked.append(g.turn_number)
            return True
        if req.kind == "play" and not g.players[0].equips and g.players[0].turn_usage.get("_launch") == 1:
            equip(g, 0, "crossbow")  # re-equipped while launched...
            equip(g, 0, "minus_horse")
        return req.default()

    drive(g.take_turn(0), answer)
    assert asked == [1]  # ...which doesn't allow a second launch this turn
    drive(g.take_turn(0), answer)
    assert asked == [1, 2]  # but the next turn does


def test_spacex_needs_two_pieces_of_equipment():
    g = heroes("yilong_ma", None, None, None)
    equip(g, 0, "plus_horse")
    asked = []
    drive(g.trigger(Event.PHASE_START, Phase.PLAY), script(confirm=lambda r: asked.append(r) or True))
    assert asked == []


# ================================================================= Mr. Liang


def test_deepseek_reveals_three_keeps_one_and_buries_the_rest():
    g = heroes("mr_liang", None, None, None)
    (c,) = give(g, 0, "dodge")
    a, b, d = (stack_top(g, lambda x, n=n: x.name == n) for n in ("peach", "strike", "duel"))
    drive(g.phase_play(g.players[0]), script(Play(skill="deepseek", cards=(c,)), choose_card=lambda r: b))
    assert hand_ids(g, 0) == [b]
    assert {g.draw_pile[0].id, g.draw_pile[1].id} == {a, d}  # on the bottom
    reveal = next(e for e in g.log if e["type"] == "reveal")
    assert {x["id"] for x in reveal["cards"]} == {a, b, d}  # shown to everyone
    assert "deepseek" not in active(g, 0)
    assert_cards_conserved(g)


def test_distillation_copies_another_players_trick_for_any_two_cards():
    g = heroes(None, "mr_liang", None, None)
    (a,) = give(g, 1, "nullify")
    horse = equip(g, 1, "plus_horse")
    (x,) = give(g, 0, "ex_nihilo")
    g.phase = Phase.PLAY
    drive(g.use_card(0, x, []), script(confirm=True, discard=[a, horse]))
    assert drawn(g, "ex_nihilo") == 4 and len(g.players[1].hand) == 2 and g.players[1].equips == []
    copy = [e for e in g.log if e["type"] == "use"][1]
    assert copy["seat"] == 1 and copy["card"]["name"] == "ex_nihilo" and copy["via"] == "distillation"
    (x,) = give(g, 0, "ex_nihilo")  # once per turn
    asked = []
    drive(g.use_card(0, x, []), script(confirm=lambda r: asked.append(r) or False))
    assert asked == []
    assert_cards_conserved(g)


def test_distillation_needs_two_cards():
    g = heroes(None, "mr_liang", None, None)
    give(g, 1, "dodge")
    (x,) = give(g, 0, "ex_nihilo")
    g.phase = Phase.PLAY
    asked = []
    drive(g.use_card(0, x, []), script(confirm=lambda r: asked.append(r) or True))
    assert asked == []


def test_distillation_of_a_delayed_trick_places_one_card_and_discards_the_other():
    g = heroes(None, "mr_liang", None, None)
    a, b = give(g, 1, "dodge", "strike")
    (x,) = give(g, 0, "indulgence")
    g.phase = Phase.PLAY
    drive(g.use_card(0, x, [2]), script(confirm=True, discard=[a, b], choose_player=lambda r: 3))
    assert [c.id for c in g.players[3].judge] == [a] and g.judge_name(g.cards[a]) == "indulgence"
    assert g.cards[b] in g.discard_pile
    assert_cards_conserved(g)


def test_distillation_picks_its_own_targets():
    g = heroes(None, "mr_liang", None, None)
    a, b = give(g, 1, "strike", "strike")
    give(g, 3, "peach")
    (d,) = give(g, 2, "dodge")
    (sn,) = give(g, 0, "snatch")
    g.phase = Phase.PLAY
    players = []

    def player(req):
        players.append(req.options)
        return 2

    drive(g.use_card(0, sn, [3]), script(confirm=True, discard=[a, b], choose_player=player))
    assert players == [[2, 0]]  # within Liang's own reach (seat 3 has nothing left)
    assert hand_ids(g, 1) == [d] and g.players[2].hand == []


def test_distillation_only_in_the_users_play_phase():
    g = heroes(None, "mr_liang", None, None)
    give(g, 1, "dodge", "strike")
    (x,) = give(g, 0, "ex_nihilo")
    g.phase = Phase.DISCARD
    asked = []
    drive(g.use_card(0, x, []), script(confirm=lambda r: asked.append(r) or False))
    assert asked == []


# ================================================================= content, test room, whole games


def test_modern_heroes_have_names_in_both_languages():
    en, zh = content_info(STANDARD, "en"), content_info(STANDARD, "zh")
    names = {h["id"]: h["name"] for h in zh["heroes"]}
    assert [names[h] for h in MODERN] == ["主席", "马克思", "川建国", "滴滴", "马一龙", "梁先生"]
    assert en["skills"]["whats_up_beijing"]["title"] == "What's up Beijing!"
    assert en["skills"]["whats_up_beijing"]["tags"] == ["lord", "limited"]
    assert zh["skills"]["slippery"]["title"] == "润滑"  # the status a Baby Oil marker gives
    # The Chairman: Aura Farmer earns the aura tokens, Do Nothing, Win spends them.
    assert [s["id"] for s in {h["id"]: h for h in en["heroes"]}["chairman"]["skills"]] == [
        "aura_farmer", "do_nothing_win", "whats_up_beijing",
    ]
    assert en["skills"]["aura_farmer"]["title"] == "Aura Farmer" and en["skills"]["do_nothing_win"]["title"] == "Do Nothing, Win"
    assert zh["skills"]["aura_farmer"]["title"] == "刷气场" and zh["skills"]["do_nothing_win"]["title"] == "躺赢"
    assert "气场" in zh["skills"]["do_nothing_win"]["text"] and "Aura" in en["skills"]["do_nothing_win"]["text"]


def test_test_room_sets_aura_tokens():
    g = heroes("chairman", None, None, None)
    set_tokens(g, 0, "aura", 3)
    assert g.players[0].tokens == {"aura": 3}
    set_tokens(g, 0, "aura", 0)
    assert g.players[0].tokens == {}
    with pytest.raises(ValueError):
        set_tokens(g, 0, "aura", 5)
    with pytest.raises(ValueError):
        set_tokens(g, 0, "chill", 1)  # (the old name)
    with pytest.raises(ValueError):
        set_tokens(g, 0, "tariff", 1)


@pytest.mark.parametrize("seed", range(12))
def test_whole_games_with_the_modern_heroes(seed):
    heroes_ = [*MODERN[seed % 6:], *MODERN[: seed % 6]][:5]
    g = new_game(5, seed, heroes=heroes_, battle=seed % 2 == 1)
    bots = [SmartBot(seed + i) if (i + seed) % 3 else SimpleBot(seed + i) for i in range(5)]
    result = play_game(g, bots)
    assert result.side in ("lord", "rebel", "spy", "draw")
    assert_cards_conserved(g)
