"""The Battle expansion (军争篇): its 52 cards and the rules they bring."""
import asyncio
from collections import Counter

import pytest

from bots import SmartBot
from content.standard import BATTLE_SPEC, build_deck, new_game
from engine import Phase, Play, Suit
from engine.driver import drive, play_game
from engine.view import view_for

from .helpers import L, R, S, Y, assert_cards_conserved, equip, give, give_where, level_lord, pass_all, stack_top
from .test_heroes import first, script


def battle(seed=0, roles=(L, Y, R, S)):
    return level_lord(new_game(len(roles), seed, list(roles), battle=True))


def strike(g, seat, nature="normal") -> int:
    return give_where(g, seat, lambda c: c.name == "strike" and c.nature == nature)


# ---------------------------------------------------------------- the deck


def test_the_expansion_is_52_cards_one_of_each_suit_and_rank():
    deck = build_deck(battle=True)
    extra = deck[len(build_deck()):]
    assert len(deck) == 160 and len(extra) == 52
    assert Counter((c.suit, c.rank) for c in extra) == {(s, r): 1 for s in (Suit.SPADE, Suit.HEART, Suit.CLUB, Suit.DIAMOND) for r in range(1, 14)}
    faces = Counter(c.name if c.nature == "normal" else f"{c.nature}_strike" for c in extra)
    assert faces == {
        "fire_strike": 5, "thunder_strike": 9, "dodge": 9, "peach": 4, "wine": 5, "fire_attack": 3,
        "iron_chain": 6, "supply_shortage": 2, "nullify": 3, "rattan_armor": 2, "silver_lion": 1,
        "ancient_blade": 1, "vermilion_fan": 1, "plus_horse": 1,
    }
    assert sum(len(ranks) for *_, ranks, _ in BATTLE_SPEC) == 52
    fire = sorted((str(c.suit), c.rank) for c in extra if c.nature == "fire")
    assert fire == [("diamond", 4), ("diamond", 5), ("heart", 4), ("heart", 7), ("heart", 10)]
    assert len(new_game(4, 0).cards) == 108  # without it: the standard deck


# ---------------------------------------------------------------- basic cards


def test_fire_and_thunder_strikes_are_strikes_with_a_nature():
    g = battle()
    fs = strike(g, 0, "fire")
    assert fs in g.play_options(g.players[0])  # an ordinary Strike to every rule
    give(g, 1, "dodge")
    drive(g.use_card(0, fs, [1]), pass_all)  # (not dodged: pass_all declines)
    dmg = next(e for e in g.log if e["type"] == "damage")
    assert (dmg["nature"], dmg["amount"]) == ("fire", 1)
    assert view_for(g, 0)["hand"] == [] and g.cards[fs].to_dict()["nature"] == "fire"

    g = battle()  # in a Duel, a Thunder Strike answers like any Strike
    (du,) = give(g, 0, "duel")
    ts = strike(g, 1, "thunder")
    drive(g.use_card(0, du, [1]), script(respond=first))
    assert g.players[0].hp == 3 and g.cards[ts] in g.discard_pile


def test_wine_makes_the_next_strike_hit_harder_once_per_turn():
    g = battle()
    (w,) = give(g, 0, "wine")
    a, b = strike(g, 0), strike(g, 0)
    drive(g.use_card(0, w, []), pass_all)
    give(g, 0, "wine")
    assert not any(g.cards[o].name == "wine" for o in g.play_options(g.players[0]))  # once per turn
    drive(g.use_card(0, a, [1]), pass_all)
    drive(g.use_card(0, b, [3]), pass_all)
    assert g.players[1].hp == 2 and g.players[3].hp == 3  # only the next Strike

    g = battle()  # used up even when the Strike is dodged
    (w,) = give(g, 0, "wine")
    a, b = strike(g, 0), strike(g, 0)
    give(g, 1, "dodge")
    drive(g.use_card(0, w, []), pass_all)
    drive(g.use_card(0, a, [1]), script(respond=first))
    drive(g.use_card(0, b, [1]), pass_all)
    assert g.players[1].hp == 3


def test_wine_saves_yourself_but_not_others():
    g = battle()
    (w,) = give(g, 2, "wine")
    g.players[2].hp = 1
    asked = []

    def respond(req):
        asked.append((req.seat, req.about, list(req.options)))
        return req.options[0] if req.options else None

    drive(g.damage(0, 2, 1), script(respond=respond))
    assert g.players[2].alive and g.players[2].hp == 1 and asked == [(2, 2, [w])]

    g = battle()  # someone else's Wine can't save them
    give(g, 1, "wine")
    g.players[2].hp = 1
    drive(g.damage(0, 2, 1), script(respond=respond))
    assert not g.players[2].alive and len(g.players[1].hand) == 1  # seat 1 was never asked


# ---------------------------------------------------------------- tricks


def test_fire_attack_burns_when_you_match_the_shown_suit():
    g = battle()
    (fa,) = give(g, 0, "fire_attack")
    shown = give_where(g, 1, lambda c: c.suit == Suit.SPADE)
    pay = give_where(g, 0, lambda c: c.suit == Suit.SPADE)
    drive(g.use_card(0, fa, [1]), script(choose_card=first))
    assert g.players[1].hp == 3 and g.cards[pay] in g.discard_pile and shown in [c.id for c in g.players[1].hand]
    assert next(e for e in g.log if e["type"] == "show")["card"]["id"] == shown
    assert next(e for e in g.log if e["type"] == "damage")["nature"] == "fire"

    g = battle()  # no card of that suit: nothing happens
    (fa,) = give(g, 0, "fire_attack")
    give_where(g, 1, lambda c: c.suit == Suit.SPADE)
    give_where(g, 0, lambda c: c.suit == Suit.HEART and c.name != "fire_attack")
    drive(g.use_card(0, fa, [1]), script(choose_card=first))
    assert g.players[1].hp == 4

    g = battle()  # only players with hand cards; you can aim it at yourself
    (fa,) = give(g, 0, "fire_attack")
    give(g, 0, "dodge")
    give(g, 2, "dodge")
    assert set(g.play_options(g.players[0])[fa].candidates) == {0, 2}


def test_iron_chain_spreads_fire_and_thunder_damage():
    g = battle()
    (ic,) = give(g, 0, "iron_chain")
    drive(g.use_card(0, ic, [1, 3]), pass_all)
    assert g.players[1].chained and g.players[3].chained and view_for(g, 2)["players"][1]["chained"]
    ts = strike(g, 0, "thunder")
    drive(g.use_card(0, ts, [1]), pass_all)
    assert (g.players[1].hp, g.players[3].hp) == (3, 3)  # it reached seat 3 too
    assert not g.players[1].chained and not g.players[3].chained
    spread = [e for e in g.log if e["type"] == "damage" and e.get("chained")]
    assert [(e["target"], e["nature"]) for e in spread] == [(3, "thunder")]
    assert_cards_conserved(g)

    g = battle()  # ordinary damage doesn't spread, and the chains stay on
    (ic,) = give(g, 0, "iron_chain")
    drive(g.use_card(0, ic, [1, 3]), pass_all)
    drive(g.use_card(0, strike(g, 0), [1]), pass_all)
    assert (g.players[1].hp, g.players[3].hp) == (3, 4) and g.players[1].chained

    drive(g.use_card(0, give(g, 0, "iron_chain")[0], [1]), pass_all)  # chaining again frees them
    assert not g.players[1].chained


def test_iron_chain_can_be_recast():
    g = battle()
    (ic,) = give(g, 0, "iron_chain")
    opt = g.play_options(g.players[0])[ic]
    assert (opt.min_targets, opt.target_count) == (0, 2)
    drive(g.phase_play(g.players[0]), script(Play(ic, ())))
    assert g.cards[ic] in g.discard_pile and len(g.players[0].hand) == 1
    assert [e["type"] for e in g.log if e["type"] in ("recast", "use")] == ["recast"]  # recast, not used


def test_supply_shortage_skips_the_draw_phase_unless_clubs():
    for suit, drawn in [(Suit.SPADE, 0), (Suit.CLUB, 2)]:
        g = battle(roles=(L, Y, R, R, S))
        (ss,) = give(g, 0, "supply_shortage")
        assert set(g.play_options(g.players[0])[ss].candidates) == {1, 4}  # distance 1 only
        drive(g.use_card(0, ss, [1]), pass_all)
        stack_top(g, lambda c: c.suit == suit)
        drive(g.take_turn(1), pass_all)
        draws = sum(e["count"] for e in g.log if e["type"] == "draw" and e["seat"] == 1)
        assert draws == drawn


# ---------------------------------------------------------------- equipment


def test_ancient_blade_hits_empty_hands_harder():
    g = battle()
    equip(g, 0, "ancient_blade")
    give(g, 3, "peach")
    drive(g.use_card(0, strike(g, 0), [1]), pass_all)
    drive(g.use_card(0, strike(g, 0), [3]), pass_all)
    assert g.players[1].hp == 2 and g.players[3].hp == 3


def test_vermilion_fan_turns_a_strike_into_a_fire_strike():
    g = battle()
    equip(g, 0, "vermilion_fan")
    s = strike(g, 0)
    strike(g, 0, "thunder")  # (already has a nature: can't be fanned)
    (conv,) = g.play_conversions(g.players[0])
    assert conv.skill == "vermilion_fan" and conv.cards == (s,)
    drive(g.phase_play(g.players[0]), script(Play(skill="vermilion_fan", cards=(s,), targets=(2,))))
    assert next(e for e in g.log if e["type"] == "damage")["nature"] == "fire"


def test_silver_lion_caps_damage_and_heals_when_lost():
    g = battle()
    lion = equip(g, 1, "silver_lion")
    drive(g.damage(None, 1, 3, nature="thunder"), pass_all)
    assert g.players[1].hp == 3
    (di,) = give(g, 0, "dismantle")
    drive(g.use_card(0, di, [1]), script(choose_card=lambda r: lion))
    assert g.players[1].hp == 4 and g.cards[lion] in g.discard_pile


def test_rattan_armor_stops_ordinary_attacks_but_burns():
    g = battle()
    equip(g, 1, "rattan_armor")
    drive(g.use_card(0, strike(g, 0), [1]), pass_all)
    (bb,) = give(g, 0, "barbarians")
    drive(g.use_card(0, bb, []), pass_all)
    assert g.players[1].hp == 4 and [p.hp for p in g.players[2:]] == [3, 3]
    drive(g.use_card(0, strike(g, 0, "thunder"), [1]), pass_all)
    assert g.players[1].hp == 3  # thunder gets through, at the usual 1
    drive(g.use_card(0, strike(g, 0, "fire"), [1]), pass_all)
    assert g.players[1].hp == 1  # fire: +1

    g = battle()  # a weapon that ignores armor gets an ordinary Strike through
    equip(g, 1, "rattan_armor")
    equip(g, 0, "piercing_sword")
    drive(g.use_card(0, strike(g, 0), [1]), pass_all)
    assert g.players[1].hp == 3


# ---------------------------------------------------------------- rooms and bots


def test_the_host_chooses_whether_to_play_with_the_expansion():
    from .test_server import FakeClient, room_with, run
    from net.room import RoomError

    async def main():
        room, (host, guest) = await room_with(2, 2)
        h = await FakeClient(room, host).connect()
        g = await FakeClient(room, guest).connect()
        assert h.of("room")[-1]["battle"] is True  # on by default
        await room.handle(host, h.conn, {"type": "deck", "battle": False})
        assert g.of("room")[-1]["battle"] is False
        with pytest.raises(RoomError, match="only the host"):
            await room.handle(guest, g.conn, {"type": "deck", "battle": True})
        with pytest.raises(RoomError, match="true or false"):
            await room.handle(host, h.conn, {"type": "deck", "battle": "yes"})
        await room.start(seed=1)
        assert len(room.game.cards) == 108
        await room.close()

    run(main())


def test_bots_play_the_expansion_cards():
    seen = Counter()
    for seed in range(40):
        n = 4 + seed % 5
        g = new_game(n, seed, draft=True, battle=True)
        play_game(g, [SmartBot(seed * 10 + i) for i in range(n)])
        assert_cards_conserved(g)
        for e in g.log:
            if e["type"] == "use" and e["card"]["name"] in ("wine", "fire_attack", "iron_chain", "supply_shortage"):
                seen[e["card"]["name"]] += 1
            elif e["type"] in ("recast", "show") or (e["type"] == "damage" and e.get("chained")):
                seen[e["type"] + ("_spread" if e.get("chained") else "")] += 1
    assert {"wine", "fire_attack", "iron_chain", "supply_shortage", "recast", "damage_spread"} <= set(seen), seen
