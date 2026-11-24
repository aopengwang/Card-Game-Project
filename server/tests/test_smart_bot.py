import copy
import random

import pytest

from bots import SimpleBot, SmartBot, make_bot
from bots.arena import run
from bots.smart import ENEMY, FRIEND
from content.standard import new_game
from engine import DiscardRequest, GameOver, Play, PlayRequest, RespondRequest, Zone
from engine.driver import drive, play_game

from .helpers import L, R, S, Y, assert_cards_conserved, game4, give, pass_all


# ---------------------------------------------------------------- legality / robustness


@pytest.mark.parametrize("n", [4, 5, 6, 7, 8])
@pytest.mark.parametrize("seed", range(12))
def test_hard_bots_always_play_legal_games(n, seed):
    g = new_game(n, 1000 + seed, draft=True)
    bots = [SmartBot(seed * 10 + i) if (i + seed) % 3 else SimpleBot(i) for i in range(n)]
    result = play_game(g, bots)  # drive() raises on any invalid answer
    assert result is g.result
    assert_cards_conserved(g)


# ---------------------------------------------------------------- no cheating


def _scramble_hidden(game, me, rng):
    """Re-deal everything `me` can't see (other hands + the draw pile), keeping counts."""
    others = [p for p in game.players if p.seat != me]
    counts = {p.seat: len(p.hand) for p in others}
    pool = [c.id for p in others for c in p.hand] + [c.id for c in game.draw_pile]
    for cid in pool:
        if game.location[cid][0] != Zone.DRAW_PILE:
            game._raw_move(cid, Zone.DRAW_PILE)
    rng.shuffle(game.draw_pile)
    for seat, n in counts.items():
        for _ in range(n):
            game._raw_move(game.draw_pile[-1].id, Zone.HAND, seat)


@pytest.mark.parametrize("seed", range(10))
def test_hard_bot_decisions_ignore_hidden_information(seed):
    """At many decision points, rearranging what the bot shouldn't be able to see (other
    hands, deck order) must not change its answer."""
    g = new_game(5, 500 + seed, draft=True)
    bots = [SmartBot(seed * 10 + i) for i in range(5)]
    rng = random.Random(seed)
    checked = 0
    step = 0

    def answer(req):
        nonlocal checked, step
        step += 1
        bot = bots[req.seat]
        if step % 2 == 0:
            # Two identical copies of (game, bot, request); scramble the hidden cards in one.
            g_same, bot_same, req_same = copy.deepcopy((g, bot, req))
            g_scr, bot_scr, req_scr = copy.deepcopy((g, bot, req))
            bot_same.game_id, bot_scr.game_id = id(g_same), id(g_scr)  # same memory, new object
            _scramble_hidden(g_scr, req.seat, rng)
            expected = bot_same(g_same, req_same)
            assert bot_scr(g_scr, req_scr) == expected, f"decision changed with hidden info at {req.kind}"
            checked += 1
        return bot(g, req)

    drive(g.run(), answer)
    assert checked > 15


def _passive(game, req):
    """A player who never plays anything and never responds (idle or ultra-cautious human)."""
    return req.default()


@pytest.mark.parametrize("n", [4, 5, 6, 8])
@pytest.mark.parametrize("seed", range(12))
def test_a_silent_player_cannot_stall_hard_bots(n, seed):
    """Regression: hard Lord-side bots never attacked a Rebel who never acted -> endless game."""
    g = new_game(n, 2000 + seed, draft=True)
    passive = seed % n
    bots = [_passive if i == passive else SmartBot(seed * 10 + i) for i in range(n)]
    play_game(g, bots)
    assert g.result is not None and g.turn_number < 400


# ---------------------------------------------------------------- strength


def test_hard_bots_beat_easy_bots():
    games = 100  # (60 was too few: with the standard heroes easy Rebels already win often)
    base = run({"lord": "easy", "rebel": "easy", "spy": "easy"}, games, 5)
    hard_lord = run({"lord": "hard", "rebel": "easy", "spy": "easy"}, games, 5)
    hard_rebels = run({"lord": "easy", "rebel": "hard", "spy": "easy"}, games, 5)
    assert hard_lord["lord"] >= base["lord"] + 15
    assert hard_rebels["rebel"] >= base["rebel"] + 10


# ---------------------------------------------------------------- reading the table


def test_attacking_the_lord_marks_you_as_an_enemy():
    g = new_game(5, 0, [L, Y, R, S, R])  # 5 players: two rebels, so allies can be hidden
    (s,) = give(g, 4, "strike")
    drive(g.use_card(4, s, [0]), pass_all)  # seat 4 (the other Rebel) attacks the Lord
    lord_bot, loyal_bot, rebel_bot = SmartBot(1), SmartBot(2), SmartBot(3)
    for bot, seat in [(lord_bot, 0), (loyal_bot, 1), (rebel_bot, 2)]:
        bot._observe(g, seat)
    assert lord_bot.rel(g, 0, 4) <= ENEMY
    assert rebel_bot.rel(g, 2, 4) >= FRIEND  # looks like a fellow rebel
    assert rebel_bot.rel(g, 2, 0) == -1.0
    assert abs(rebel_bot.rel(g, 2, 3)) < FRIEND  # the quiet Spy is still unknown


def test_role_counting_deduces_enemies():
    g = game4(L, Y, R, S)  # 4 players: one Loyalist, one Rebel
    (s,) = give(g, 3, "strike")
    drive(g.use_card(3, s, [0]), pass_all)  # seat 3 (secretly the Spy) attacks the Lord
    lord_bot, loyal_bot, rebel_bot = SmartBot(1), SmartBot(2), SmartBot(3)
    for bot, seat in [(lord_bot, 0), (loyal_bot, 1), (rebel_bot, 2)]:
        bot._observe(g, seat)
    assert lord_bot.rel(g, 0, 3) <= ENEMY
    # The only Loyalist knows every unknown player is against the Lord, even one who has
    # done nothing yet (seat 2)...
    assert loyal_bot.rel(g, 1, 2) <= ENEMY and loyal_bot.rel(g, 1, 3) <= ENEMY
    assert loyal_bot.rel(g, 1, 0) == 1.0  # ...and the Lord is always a friend
    # The only Rebel knows seat 3 can't be a fellow rebel, however it acts.
    assert rebel_bot.rel(g, 2, 3) <= ENEMY


def test_saving_a_suspect_makes_you_a_suspect():
    g = game4(L, R, Y, S)
    (s,) = give(g, 1, "strike")
    drive(g.use_card(1, s, [0]), pass_all)  # seat 1 attacks the Lord: suspected rebel
    g.players[1].hp = 0
    (pe,) = give(g, 3, "peach")
    drive(g.dying(1, None), lambda r: pe if isinstance(r, RespondRequest) and r.seat == 3 else r.default())
    lord_bot = SmartBot(0)
    lord_bot._observe(g, 0)
    assert lord_bot.rel(g, 0, 3) <= ENEMY  # spent a Peach on the Lord's attacker


def test_loyalist_saves_the_lord_rebel_does_not():
    for role_of_helper, expect in [(Y, True), (R, False)]:
        roles = (L, role_of_helper, R if role_of_helper == Y else Y, S)
        g = game4(*roles)
        g.players[0].hp = 0
        (pe,) = give(g, 1, "peach")
        bot = SmartBot(0)
        asked = []

        def answer(req):
            if isinstance(req, RespondRequest) and req.seat == 1:
                ans = bot(g, req)
                asked.append(ans)
                return ans
            return req.default()

        try:
            drive(g.dying(0, None), answer)
        except GameOver:
            pass  # the Lord dying ends the game
        assert bool(asked and asked[0] == pe) == expect


def test_clears_a_friends_indulgence_and_never_strikes_the_lord_as_loyalist():
    g = game4(L, Y, R, S)
    (ind,) = give(g, 2, "indulgence")
    drive(g.use_card(2, ind, [0]), pass_all)  # rebel indulges the Lord
    d, s = give(g, 1, "dismantle", "strike")
    bot = SmartBot(0)
    g.current = 1
    req = PlayRequest(seat=1, options=g.play_options(g.players[1]))
    play = bot(g, req)
    assert play == Play(d, (0,))
    choose = []
    drive(g.use_card(1, d, [0]), lambda r: (choose.append(bot(g, r)) or choose[-1]) if r.kind == "choose_card" else r.default())
    assert choose == [ind] and g.players[0].judge == []
    # Never strike the Lord as a Loyalist, even with nobody else identified.
    req = PlayRequest(seat=1, options=g.play_options(g.players[1]))
    play = bot(g, req)
    assert play is None or 0 not in play.targets


def test_spy_balances_then_turns_on_everyone():
    g = game4(L, Y, R, S)
    bot = SmartBot(0)
    bot._observe(g, 3)
    assert bot._spy_mode(g, 3) in ("protect", "balance")
    g.players[2].alive = False  # the last rebel is revealed dead
    assert bot._spy_mode(g, 3) == "endgame"
    assert bot.rel(g, 3, 1) == -1.0
    assert bot.rel(g, 3, 0) > -1.0  # the Lord is saved for last while others remain


def test_discards_lowest_value_cards():
    g = game4()
    pe, do, li, st = give(g, 0, "peach", "dodge", "lightning", "strike")
    bot = SmartBot(0)
    req = DiscardRequest(seat=0, count=2, options=[pe, do, li, st])
    assert set(bot(g, req)) == {li, st}


def test_make_bot_levels():
    assert isinstance(make_bot("easy"), SimpleBot) and isinstance(make_bot("hard"), SmartBot)
    with pytest.raises(KeyError):
        make_bot("impossible")


def test_hero_draft_prefers_strong_heroes_and_lord_heroes():
    g = new_game(5, 3, draft=True)
    gen = g.run()
    req = next(gen)
    pick = SmartBot(0)(g, req)
    assert g.ruleset.heroes[pick].has_lord_skill
