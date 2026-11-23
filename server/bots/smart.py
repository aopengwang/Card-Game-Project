"""The "hard" bot: reads the table, infers allegiances, and plays its role.

Fair play: it only uses what a human in its seat could know: its own hand and
role, public state (HP, equipment, judgment areas, hand *counts*, revealed
roles) and its own view of the log (engine.view.log_for). tests/test_smart_bot.py
checks this by rearranging other players' hidden cards and asserting the bot's
decisions don't change.

How it thinks:
- Allegiance: every player gets a score (+ = Lord's side, - = Rebel side). Public
  actions move it: attacking someone shifts you *against* that person's side,
  saving / helping / nullifying for them shifts you *towards* it.
- Relation: from that score and its own role the bot rates every other player
  from -1 (enemy) to +1 (friend). Rebels always treat the Lord as the enemy; the
  Spy sides with the Lord until the rebels are gone, then turns on everyone.
- Decisions: value cards (keep Peaches and Dodges), pick targets by relation, HP
  and defences, only use area attacks when they hurt enemies more than friends,
  and spend Nullify where it matters.
"""
from __future__ import annotations

import math
import random
from typing import Any

from engine import (
    HAND,
    ROLE_TABLE,
    ChooseCardRequest,
    ChooseHeroRequest,
    ChooseOptionRequest,
    ChoosePlayerRequest,
    ConfirmRequest,
    Convert,
    DiscardRequest,
    EquipDef,
    EquipSlot,
    Game,
    Play,
    PlayRequest,
    Request,
    RespondRequest,
    Role,
)
from engine.view import log_for, role_visible

# ---------------------------------------------------------------- tuning tables

CARD_VALUE = {
    "peach": 9, "nullify": 7, "ex_nihilo": 7, "dodge": 6, "snatch": 6, "indulgence": 6,
    "duel": 5, "dismantle": 5, "strike": 4, "barbarians": 4, "arrows": 4, "borrowed_sword": 3,
    "harvest": 3, "peach_garden": 3, "lightning": 1,
}
EQUIP_VALUE = {
    "eight_trigrams": 7, "benevolent_shield": 6, "minus_horse": 5, "plus_horse": 5, "crossbow": 5,
    "serpent_spear": 4, "dragon_glaive": 4, "stone_axe": 4, "piercing_sword": 4, "frost_blade": 4,
    "twin_swords": 3, "halberd": 3, "kirin_bow": 3,
}
HERO_TIER = {
    "wei_lie": 9, "zhuge_liang": 8, "cao_cao": 8, "lu_xun": 8, "sima_yi": 7, "liu_bei": 7,
    "sun_quan": 7, "zhou_yu": 7, "lu_bu": 7, "diaochan": 7, "hua_tuo": 6, "zhang_liao": 6,
    "guan_yu": 6, "yu_ji": 6,
}
# How strongly a public action reveals allegiance (weight of "acting against X").
HOSTILE_WEIGHT = {
    "strike": 1.0, "duel": 1.0, "indulgence": 1.2, "dismantle": 0.5, "snatch": 0.5, "borrowed_sword": 0.3,
}
HARMFUL_TRICKS = {"dismantle", "snatch", "duel", "barbarians", "arrows", "indulgence", "lightning", "borrowed_sword"}
HELPFUL_TRICKS = {"ex_nihilo", "peach_garden", "harvest"}
HARMFUL_SKILLS = {"iron_edict", "east_wind", "seize_power", "allure"}
FRIENDLY_SKILLS = {"gather_the_righteous"}
GOOD_JUDGMENTS = {"eight_trigrams", "five_animals"}
SKILL_MIN_HAND = {"iron_edict": 2, "seize_power": 3, "allure": 2, "gather_the_righteous": 2}

FRIEND, ENEMY = 0.3, -0.3  # relation thresholds


class SmartBot:
    def __init__(self, seed: int = 0):
        self.rng = random.Random(seed)
        self.seat: int | None = None
        self.score: dict[int, float] = {}
        self.cursor = 0
        self.dying: int | None = None
        self.game_id: int | None = None

    # ================================================================ entry

    def __call__(self, game: Game, req: Request) -> Any:
        self._observe(game, req.seat)
        me = req.seat
        if isinstance(req, PlayRequest):
            return self._play(game, me, req)
        if isinstance(req, RespondRequest):
            return self._respond(game, me, req)
        if isinstance(req, DiscardRequest):
            return self._discard(game, me, req)
        if isinstance(req, ChooseCardRequest):
            return self._choose_card(game, me, req)
        if isinstance(req, ConfirmRequest):
            return self._confirm(game, me, req)
        if isinstance(req, ChoosePlayerRequest):
            return self._choose_player(game, me, req)
        if isinstance(req, ChooseOptionRequest):
            return self._choose_option(game, me, req)
        if isinstance(req, ChooseHeroRequest):
            return self._choose_hero(game, me, req)
        return req.default()

    # ================================================================ public knowledge

    def _known_role(self, game: Game, me: int, seat: int) -> Role | None:
        p = game.players[seat]
        return p.role if role_visible(game, me, p) else None

    def _alive(self, game: Game) -> list[int]:
        return [p.seat for p in game.alive_players()]

    def _rebels_left(self, game: Game, me: int) -> int:
        """Rebels still alive, from the role table minus revealed dead rebels (public info)."""
        total = ROLE_TABLE[len(game.players)].count(Role.REBEL)
        dead = sum(1 for p in game.players if not p.alive and self._known_role(game, me, p.seat) == Role.REBEL)
        return total - dead

    def _hand(self, game: Game, me: int):  # only ever our OWN hand
        return game.players[me].hand

    def _hand_count(self, game: Game, seat: int) -> int:
        return len(game.players[seat].hand)  # counts are public

    # ================================================================ allegiance inference

    def _observe(self, game: Game, me: int) -> None:
        if self.game_id != id(game) or self.seat != me:
            self.game_id, self.seat, self.cursor, self.score, self.dying = id(game), me, 0, {}, None
        entries = log_for(game, me, self.cursor)
        self.cursor += len(entries)
        for e in entries:
            self._learn(game, me, e)

    def _stance(self, game: Game, me: int, seat: int) -> float:
        """Best public guess of `seat`'s side: + Lord's side, - Rebels."""
        role = self._known_role(game, me, seat)
        if role == Role.LORD:
            return 1.5
        if role == Role.LOYALIST:
            return 1.0
        if role == Role.REBEL:
            return -1.0
        if role == Role.SPY:
            return 0.0
        return math.tanh(self.score.get(seat, 0.0) / 2)

    def _shift(self, game: Game, me: int, actor: int | None, target: int | None, w: float) -> None:
        """actor acted for (+w) or against (-w) target."""
        if actor is None or target is None or actor == target:
            return
        self.score[actor] = self.score.get(actor, 0.0) + w * self._stance(game, me, target)

    def _learn(self, game: Game, me: int, e: dict) -> None:
        t = e["type"]
        if t == "use":
            w = HOSTILE_WEIGHT.get(e["card"]["name"])
            if w:
                for target in e["targets"]:
                    self._shift(game, me, e["seat"], target, -w)
        elif t == "skill" and e.get("targets"):
            if e["skill"] in HARMFUL_SKILLS:
                for target in e["targets"]:
                    self._shift(game, me, e["seat"], target, -1.0)
            elif e["skill"] in FRIENDLY_SKILLS:
                for target in e["targets"]:
                    self._shift(game, me, e["seat"], target, 0.5)
        elif t == "borrowed_sword":
            self._shift(game, me, e["seat"], e["victim"], -0.8)
        elif t == "dying":
            self.dying = e["seat"]
        elif t == "recover":
            if self.dying is not None and e["seat"] == self.dying and e.get("source") not in (None, e["seat"]):
                self._shift(game, me, e["source"], e["seat"], 2.0)  # spent a Peach to save them
        elif t == "death":
            self.dying = None
        elif t == "turn_start":
            self.dying = None
        elif t == "nullify":
            name = e["card"]["name"]
            if name in HARMFUL_TRICKS:
                self._shift(game, me, e["seat"], e["target"], 1.0 if e["cancelled"] else -1.0)
            elif name in HELPFUL_TRICKS:
                self._shift(game, me, e["seat"], e["target"], -1.0 if e["cancelled"] else 1.0)
        elif t == "respond" and e.get("reason") == "shield_wall":
            self._shift(game, me, e["seat"], game.lord_seat, 1.5)
        elif t == "give":
            self._shift(game, me, e["seat"], e["target"], 0.4)

    def rel(self, game: Game, me: int, seat: int | None) -> float:
        """How much `me` should want to help `seat`: -1 enemy .. +1 friend."""
        if seat is None:
            return 0.0
        if seat == me:
            return 1.0
        my_role = game.players[me].role
        known = self._known_role(game, me, seat)
        guess = math.tanh(self.score.get(seat, 0.0) / 2)
        if my_role in (Role.LORD, Role.LOYALIST):
            if known in (Role.LORD, Role.LOYALIST):
                return 1.0
            if known == Role.REBEL:
                return -1.0
            if known == Role.SPY:
                return -1.0 if self._rebels_left(game, me) == 0 else 0.0
            return guess
        if my_role == Role.REBEL:
            if known in (Role.LORD, Role.LOYALIST):
                return -1.0
            if known == Role.REBEL:
                return 1.0
            return -guess
        # Spy: keep the two sides balanced while rebels remain (the Spy needs the Lord alive
        # until the end, but can't let the Lord's side get too strong either); afterwards
        # everyone is in the way, the Lord last of all.
        mode = self._spy_mode(game, me)
        if mode == "endgame":
            if known == Role.LORD:
                return -1.0 if len(self._alive(game)) <= 2 else -0.2
            return -1.0
        if mode == "balance":
            if known == Role.LORD:
                return 0.3  # never attack the Lord while rebels are around
            if known == Role.LOYALIST or guess > FRIEND:
                return -0.7
            return 0.0
        if known == Role.LORD:
            return 0.6
        if known == Role.REBEL:
            return -1.0
        return 0.6 * guess

    def _spy_mode(self, game: Game, me: int) -> str:
        if self._rebels_left(game, me) == 0:
            return "endgame"
        lord = game.players[game.lord_seat]
        if lord.hp <= 2:
            return "protect"
        others = [p for p in game.alive_players() if p.seat != me]
        lord_side = sum(p.hp for p in others if self._stance(game, me, p.seat) > FRIEND)
        rebel_side = sum(p.hp for p in others if self._stance(game, me, p.seat) < ENEMY)
        return "balance" if lord_side > rebel_side + 3 else "protect"

    def _enemies(self, game: Game, me: int, cands) -> list[int]:
        es = [c for c in cands if c != me and self.rel(game, me, c) <= ENEMY]
        if game.players[me].role == Role.REBEL and game.lord_seat in cands and game.lord_seat not in es:
            es.append(game.lord_seat)
        return sorted(es, key=lambda s: self._threat_order(game, me, s))

    def _threat_order(self, game: Game, me: int, s: int) -> tuple:
        p = game.players[s]
        return (self.rel(game, me, s), p.hp, -self._hand_count(game, s))

    def _focus(self, game: Game, me: int, seat: int) -> float:
        """Extra priority for hurting `seat`: rebels win the moment the Lord falls."""
        if game.players[me].role == Role.REBEL and seat == game.lord_seat:
            return 1.5
        return 0.0

    def _friends(self, game: Game, me: int, cands) -> list[int]:
        return [c for c in cands if self.rel(game, me, c) >= FRIEND]

    # ================================================================ card values

    def _value(self, game: Game, me: int, cid: int, hand_ids: list[int] | None = None) -> float:
        card = game.cards[cid]
        d = game.card_def(card)
        p = game.players[me]
        if isinstance(d, EquipDef):
            cur = game.equip_in(p, d.slot)
            if cur is not None and cur.id == cid:
                return EQUIP_VALUE.get(card.name, 3) + 1  # equipped
            mine = EQUIP_VALUE.get(card.name, 3)
            return mine if cur is None or EQUIP_VALUE.get(cur.name, 3) < mine else 1
        v = CARD_VALUE.get(card.name, 3)
        hand = [game.cards[i] for i in (hand_ids if hand_ids is not None else [c.id for c in p.hand])]
        same = [c for c in hand if c.name == card.name]
        # Spare copies are worth less (the first copy in hand keeps full value; a card that
        # isn't in our hand yet is a spare if we already hold one)...
        spare = same.index(card) > 0 if card in same else bool(same)
        if spare:
            v -= 1 if card.name == "strike" and game.strike_limit(p) > 1 else 2  # ...unless a crossbow wants them
        if card.name == "peach" and p.hp <= 1:
            v += 3
        return v

    def _lowest(self, game: Game, me: int, ids, n: int) -> list[int]:
        ids = list(ids)
        return sorted(ids, key=lambda i: (self._value(game, me, i), i))[:n]

    # ================================================================ play phase

    def _play(self, game: Game, me: int, req: PlayRequest) -> Play | None:
        p = game.players[me]
        by_name: dict[str, list] = {}
        for opt in req.options.values():
            by_name.setdefault(game.cards[opt.card_id].name, []).append(opt)

        def first(name):
            return by_name.get(name, [None])[0]

        # 1. Heal when it matters.
        if (o := first("peach")) and p.is_wounded and (p.hp <= 2 or len(by_name["peach"]) > 1 or len(p.hand) > game.hand_limit(p)):
            return Play(o.card_id)

        # 2. Equipment upgrades.
        for name, opts in by_name.items():
            opt = opts[0]
            d = game.card_def(game.cards[opt.card_id])
            if isinstance(d, EquipDef):
                cur = game.equip_in(p, d.slot)
                if cur is None or EQUIP_VALUE.get(cur.name, 3) < EQUIP_VALUE.get(name, 3):
                    return Play(opt.card_id)

        # 3. Free cards.
        if o := first("ex_nihilo"):
            return Play(o.card_id)

        # 4. Active skills and play-phase conversions.
        if (play := self._skill_play(game, me, req)) is not None:
            return play

        # 5. Clear a friend's judgment area, then disrupt enemies.
        if o := first("dismantle"):
            target = self._dismantle_target(game, me, o.candidates)
            if target is not None:
                return Play(o.card_id, (target,))
        if o := first("snatch"):
            target = self._steal_target(game, me, o.candidates)
            if target is not None:
                return Play(o.card_id, (target,))
        if o := first("indulgence"):
            es = self._enemies(game, me, o.candidates)
            if es:
                best = max(es, key=lambda s: (self._focus(game, me, s), self._hand_count(game, s), -self.rel(game, me, s)))
                return Play(o.card_id, (best,))
        if o := first("borrowed_sword"):
            wielders = [w for w in o.candidates if self.rel(game, me, w) <= ENEMY]
            if wielders:
                return Play(o.card_id, (wielders[0],))

        # 6. Duels we expect to win.
        if o := first("duel"):
            my_strikes = sum(1 for c in p.hand if c.name == "strike")

            def worth(s: int) -> bool:
                if self._focus(game, me, s) and (my_strikes or game.players[s].hp <= 2):
                    return True  # trading blows with the Lord is good for a rebel
                return self._hand_count(game, s) <= 2 * my_strikes + 1

            es = [s for s in self._enemies(game, me, o.candidates) if worth(s)]
            if es:
                return Play(o.card_id, (min(es, key=lambda s: (game.players[s].hp, self._hand_count(game, s))),))

        # 7. Area attacks only when they hurt enemies more than friends.
        for name in ("barbarians", "arrows"):
            if (o := first(name)) and self._aoe_worth(game, me):
                return Play(o.card_id)

        # 8. Strike the best target in range.
        if by_name.get("strike"):
            play = self._strike_play(game, me, by_name["strike"])
            if play is not None:
                return play

        # 9. Group cards that favour our side.
        if (o := first("peach_garden")) and self._garden_worth(game, me):
            return Play(o.card_id)
        if (o := first("harvest")) and sum(self.rel(game, me, s) for s in self._alive(game)) > 0.5:
            return Play(o.card_id)
        if (o := first("lightning")) and p.hp >= 4 and sum(self.rel(game, me, s) for s in self._alive(game) if s != me) < -1:
            return Play(o.card_id)
        return None

    def _aoe_worth(self, game: Game, me: int) -> float:
        total = 0.0
        for s in self._alive(game):
            if s == me:
                continue
            r = self.rel(game, me, s)
            hit = 0.45 if self._hand_count(game, s) >= 3 else 0.75
            weight = 3.0 if game.players[s].hp <= 1 else 1.0
            total += (-r + self._focus(game, me, s)) * hit * weight
        return total > 0.6

    def _garden_worth(self, game: Game, me: int) -> bool:
        return sum(self.rel(game, me, p.seat) for p in game.alive_players() if p.is_wounded) > 0.5

    def _strike_play(self, game: Game, me: int, opts) -> Play | None:
        cands = list(opts[0].candidates)
        es = self._enemies(game, me, cands)
        if not es:
            return None

        def score(s: int) -> float:
            t = game.players[s]
            armor = game.equip_in(t, EquipSlot.ARMOR)
            penalty = 0.0
            if armor is not None and armor.name == "eight_trigrams" and game.weapon_def(game.players[me]) is None:
                penalty = 0.4
            return -self.rel(game, me, s) * 2 + (3 - min(t.hp, 3)) * 0.6 - penalty + self._focus(game, me, s)

        target = max(es, key=score)
        t = game.players[target]
        armor = game.equip_in(t, EquipSlot.ARMOR)
        pick = opts[0]
        if armor is not None and armor.name == "benevolent_shield":
            reds = [o for o in opts if game.cards[o.card_id].is_red]
            if not reds:
                others = [s for s in es if s != target]
                if not others:
                    return None
                target = max(others, key=score)
            else:
                pick = reds[0]
        targets = [target]
        if pick.target_count > 1:
            targets += [s for s in es if s != target and s in pick.candidates][: pick.target_count - 1]
        return Play(pick.card_id, tuple(targets))

    def _dismantle_target(self, game: Game, me: int, cands) -> int | None:
        for s in cands:  # a friend stuck with Indulgence / Lightning: clear it
            if self.rel(game, me, s) >= FRIEND and any(c.name in ("indulgence", "lightning") for c in game.players[s].judge):
                return s
        return self._steal_target(game, me, cands)

    def _steal_target(self, game: Game, me: int, cands) -> int | None:
        es = self._enemies(game, me, cands)
        if not es:
            return None
        return max(es, key=lambda s: (len(game.players[s].equips) * 2 + self._hand_count(game, s), -self.rel(game, me, s)))

    def _skill_play(self, game: Game, me: int, req: PlayRequest) -> Play | None:
        p = game.players[me]
        for opt in req.skills:
            if len(p.hand) < SKILL_MIN_HAND.get(opt.skill, 0):
                continue
            friendly = opt.skill in FRIENDLY_SKILLS
            pool = self._friends(game, me, [c for c in opt.candidates if c != me]) if friendly else self._enemies(game, me, opt.candidates)
            if opt.skill == "east_wind" and not (len(pool) >= 2 or any(game.players[s].hp <= 1 for s in pool)):
                continue
            if opt.min_targets and not pool:
                continue
            n = min(len(pool), opt.target_count) if not friendly else opt.min_targets
            targets = tuple(pool[:n])
            cards = tuple(self._lowest(game, me, opt.cards, opt.min_cards))
            if game.check_skill_use(game.players[me], opt.skill, list(cards), list(targets)) is None:
                return Play(skill=opt.skill, cards=cards, targets=targets)
        for conv in req.conversions:
            if conv.as_name in ("barbarians", "arrows") and self._aoe_worth(game, me):
                cards = self._conversion_cards(game, me, conv)
                if cards is not None:
                    return Play(skill=conv.skill, cards=cards)
            if conv.as_name == "strike" and len(p.hand) >= 4 and not any(c.name == "strike" for c in p.hand):
                es = self._enemies(game, me, conv.candidates)
                cards = self._conversion_cards(game, me, conv)
                if es and cards is not None:
                    return Play(skill=conv.skill, cards=cards, targets=(es[0],))
        return None

    def _conversion_cards(self, game: Game, me: int, conv) -> tuple[int, ...] | None:
        """Cheapest legal set of cards for a conversion (respecting rules like 'same suit')."""
        ranked = self._lowest(game, me, conv.cards, len(conv.cards))
        if conv.count == 2:
            for i, a in enumerate(ranked):
                for b in ranked[i + 1:]:
                    if game.check_skill_use(game.players[me], conv.skill, [a, b], []) is None:
                        return (a, b)
            return None
        cards = tuple(ranked[: conv.count])
        return cards if game.check_skill_use(game.players[me], conv.skill, list(cards), []) is None else None

    # ================================================================ responses

    def _respond(self, game: Game, me: int, req: RespondRequest) -> Any:
        want = self._want_response(game, me, req)
        if not want:
            return None
        if req.options:
            return self._lowest(game, me, req.options, 1)[0]
        for conv in req.conversions:  # only a conversion is possible: worth spending 2 cards?
            if game.players[me].hp <= 2 or req.card_name == "nullify":
                cards = self._conversion_cards(game, me, conv)
                if cards is not None:
                    return Convert(conv.skill, cards)
        return None

    def _want_response(self, game: Game, me: int, req: RespondRequest) -> bool:
        name, reason = req.card_name, req.reason
        p = game.players[me]
        if name == "dodge":
            if reason == "shield_wall":
                return self.rel(game, me, req.about) >= FRIEND
            return True
        if name == "peach":
            dying = req.about
            if dying == me:
                return True
            if game.players[me].role == Role.SPY and dying == game.lord_seat and self._rebels_left(game, me) > 0:
                return True
            return self.rel(game, me, dying) >= 0.5
        if name == "strike":
            if reason in ("borrowed_sword", "allure"):
                return self.rel(game, me, req.about) < FRIEND
            if reason == "dragon_glaive":
                return self.rel(game, me, req.about) <= ENEMY
            return True  # duel / barbarians
        if name == "nullify":
            return self._want_nullify(game, me, req)
        return True

    def _want_nullify(self, game: Game, me: int, req: RespondRequest) -> bool:
        ctx = req.context
        card, target, cancelled = ctx["card"]["name"], ctx["target"], ctx["cancelled"]
        r = self.rel(game, me, target)
        p = game.players[me]
        if card in HARMFUL_TRICKS:
            if r < FRIEND:
                want_cancel = False
            elif target == me and card in ("barbarians", "arrows"):
                answer = "strike" if card == "barbarians" else "dodge"
                want_cancel = not any(c.name == answer for c in p.hand) and p.hp <= 2
            elif card in ("dismantle", "snatch"):
                want_cancel = r >= 0.6 and len(game.players[target].equips) > 0
            else:
                want_cancel = True
        elif card in HELPFUL_TRICKS:
            want_cancel = r <= -0.6 and card == "ex_nihilo"
        else:
            want_cancel = False
        return want_cancel != cancelled

    # ================================================================ other requests

    def _discard(self, game: Game, me: int, req: DiscardRequest) -> list[int]:
        return self._lowest(game, me, req.options, req.count)

    def _choose_card(self, game: Game, me: int, req: ChooseCardRequest) -> Any:
        if req.about is None:  # harvest-style pick from revealed cards
            return max(req.options, key=lambda i: (self._value(game, me, i), -i))
        if req.about == me:  # giving away one of our own cards
            return self._lowest(game, me, req.options, 1)[0]
        target = game.players[req.about]
        r = self.rel(game, me, req.about)
        judge = [c.id for c in target.judge if c.id in req.options]
        if r >= FRIEND:
            if judge:
                return judge[0]  # clear their Indulgence / Lightning
            if req.optional:
                return None
            return HAND if req.hidden_count else self._lowest(game, me, req.options, 1)[0]
        equips = [c for c in target.equips if c.id in req.options]
        if req.reason == "kirin_bow":
            horses = sorted(equips, key=lambda c: c.name != "plus_horse")
            return horses[0].id if horses else None
        if equips:
            best = max(equips, key=lambda c: (EQUIP_VALUE.get(c.name, 3), -c.id))
            if EQUIP_VALUE.get(best.name, 3) >= 5 or not req.hidden_count:
                return best.id
        if req.hidden_count:
            return HAND
        non_judge = [i for i in req.options if i not in judge]
        return (non_judge or req.options)[0] if req.options else None

    def _confirm(self, game: Game, me: int, req: ConfirmRequest) -> bool:
        r = self.rel(game, me, req.about)
        if req.reason == "omen":
            good_hit = req.context["judge_reason"] in GOOD_JUDGMENTS
            good_for_them = req.context["would_hit"] == good_hit
            return (r >= FRIEND and not good_for_them) or (r <= ENEMY and good_for_them)
        if req.reason == "frost_blade":
            t = game.players[req.about] if req.about is not None else None
            if r >= FRIEND:
                return True  # don't hurt a friend we hit by accident
            return t is not None and t.hp >= 3 and len(t.equips) > 0
        if req.reason == "twin_swords":
            return r < FRIEND
        if req.reason == "stone_axe":
            t = game.players[req.about]
            return r <= ENEMY and (t.hp <= 2 or len(game.players[me].hand) >= 4)
        return True  # eight_trigrams, shield_wall

    def _choose_player(self, game: Game, me: int, req: ChoosePlayerRequest) -> int:
        others = [s for s in req.options if s != me] or req.options
        es = self._enemies(game, me, others)
        if es:
            return es[0]
        return min(others, key=lambda s: self.rel(game, me, s))

    def _choose_option(self, game: Game, me: int, req: ChooseOptionRequest) -> str:
        p = game.players[me]
        r = self.rel(game, me, req.about)
        if req.reason == "iron_edict" and "give_card" in req.choices:
            cheap = min((self._value(game, me, c.id) for c in p.hand), default=99)
            return "give_card" if p.hp <= 2 or cheap <= 4 else "take_damage"
        if req.reason == "twin_swords" and "discard" in req.choices:
            cheap = min((self._value(game, me, c.id) for c in p.hand), default=99)
            return "let_draw" if r >= FRIEND or cheap > 3 else "discard"
        return req.choices[0]

    def _choose_hero(self, game: Game, me: int, req: ChooseHeroRequest) -> str:
        is_lord = me == game.lord_seat

        def rank(h: str) -> tuple:
            hero = game.ruleset.heroes.get(h)
            lord_bonus = 2 if is_lord and hero is not None and hero.has_lord_skill else 0
            hp = hero.max_hp if hero is not None else 3
            return (HERO_TIER.get(h, 5) + lord_bonus + (hp - 3) * 0.5, self.rng.random())

        return max(req.options, key=rank)
