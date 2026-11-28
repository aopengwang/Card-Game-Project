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
    ArrangeRequest,
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
    "supply_shortage": 6, "wine": 5, "duel": 5, "dismantle": 5, "strike": 4, "barbarians": 4,
    "arrows": 4, "fire_attack": 4, "borrowed_sword": 3, "harvest": 3, "peach_garden": 3,
    "iron_chain": 3, "lightning": 1,
}
EQUIP_VALUE = {
    "eight_trigrams": 7, "benevolent_shield": 6, "silver_lion": 6, "minus_horse": 5, "plus_horse": 5,
    "crossbow": 5, "rattan_armor": 5, "vermilion_fan": 5, "serpent_spear": 4, "dragon_glaive": 4,
    "stone_axe": 4, "piercing_sword": 4, "frost_blade": 4, "ancient_blade": 4, "twin_swords": 3,
    "halberd": 3, "kirin_bow": 3,
}
HERO_TIER = {
    "guo_jia": 9, "liu_bei": 8, "sun_quan": 8, "zhang_liao": 8, "hua_tuo": 8, "diaochan": 8, "wei_lie": 8,
    "cao_cao": 7, "sima_yi": 7, "zhuge_liang": 7, "zhao_yun": 7, "huang_yueying": 7, "zhou_yu": 7,
    "lu_xun": 7, "sun_shangxiang": 7, "da_qiao": 7, "zhen_ji": 7, "huang_gai": 7, "lu_bu": 7,
    "xiahou_dun": 6, "zhang_fei": 6, "ma_chao": 6, "gan_ning": 6, "lu_meng": 6, "guan_yu": 6,
    "xu_chu": 5, "yu_ji": 6,
    "chairman": 6, "marks": 6, "donald": 7, "diddy": 6, "yilong_ma": 6, "mr_liang": 7,
}
# How strongly a public action reveals allegiance (weight of "acting against X").
HOSTILE_WEIGHT = {
    "strike": 1.0, "duel": 1.0, "indulgence": 1.2, "supply_shortage": 1.2, "fire_attack": 0.8,
    "dismantle": 0.5, "snatch": 0.5, "borrowed_sword": 0.3,
}
HARMFUL_TRICKS = {
    "dismantle", "snatch", "duel", "barbarians", "arrows", "indulgence", "lightning", "borrowed_sword",
    "fire_attack", "supply_shortage",
}
HELPFUL_TRICKS = {"ex_nihilo", "peach_garden", "harvest"}
HARMFUL_SKILLS = {"false_letter", "call_to_arms", "tariffs", "baby_oil"}
FRIENDLY_SKILLS = {"open_hand", "wedding_vow", "healing_herbs"}
# Judgments where a hit is good for the judged player (others: a hit is bad for them).
GOOD_JUDGMENTS = {"eight_trigrams", "rippling_steps", "blood_for_blood", "headlong_charge"}
# The rule behind each judgment, so the bot can tell what a replacement card would do.
JUDGE_RULES = {
    "indulgence": lambda c: c["suit"] != "heart",
    "supply_shortage": lambda c: c["suit"] != "club",
    "lightning": lambda c: c["suit"] == "spade" and 2 <= c["rank"] <= 9,
    "eight_trigrams": lambda c: c["suit"] in ("heart", "diamond"),
    "headlong_charge": lambda c: c["suit"] in ("heart", "diamond"),
    "rippling_steps": lambda c: c["suit"] in ("spade", "club"),
    "blood_for_blood": lambda c: c["suit"] != "heart",
    "slippery": lambda c: c["suit"] in ("spade", "club"),
}
ASK_FOR_LORD = {"shield_wall", "guard_the_throne", "call_to_arms"}  # play a card for the Lord

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
        if isinstance(req, ArrangeRequest):
            return self._arrange(game, me, req)
        return req.default()

    # ================================================================ public knowledge

    def _known_role(self, game: Game, me: int, seat: int) -> Role | None:
        p = game.players[seat]
        return p.role if role_visible(game, me, p) else None

    def _alive(self, game: Game) -> list[int]:
        return [p.seat for p in game.alive_players()]

    def _rebels_left(self, game: Game, me: int) -> int:
        """Rebels still alive: how many were dealt minus revealed dead rebels (public info)."""
        total = self._dealt(game, Role.REBEL)
        dead = sum(1 for p in game.players if not p.alive and self._known_role(game, me, p.seat) == Role.REBEL)
        return total - dead

    @staticmethod
    def _dealt(game: Game, role: Role) -> int:
        """How many players were dealt `role`. The mix of roles is public; who holds them isn't."""
        return sum(1 for p in game.players if p.role == role)

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
        elif t == "skill" and e["skill"] == "rivalry" and len(e.get("targets") or []) == 2:
            self._shift(game, me, e["seat"], e["targets"][1], -1.0)  # set the first on the second
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
        elif t == "respond" and e.get("reason") in ASK_FOR_LORD:
            self._shift(game, me, e["seat"], game.lord_seat, 1.5)
        elif t == "redirect":
            self._shift(game, me, e["seat"], e["target"], -1.0)  # passed a Strike on to them
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
            if self._hidden_allies(game, me) == 0:
                return -0.8  # every Loyalist is accounted for: whoever is left is against us
            return guess - self._pressure(game)
        if my_role == Role.REBEL:
            if known in (Role.LORD, Role.LOYALIST):
                return -1.0
            if known == Role.REBEL:
                return 1.0
            if self._hidden_allies(game, me) == 0:
                return -0.8  # no other rebels left: everyone else is in the way
            return -guess - self._pressure(game)
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

    def _hidden_allies(self, game: Game, me: int) -> int:
        """Allies of `me` that could still be hiding among the unrevealed players, from the
        public mix of roles: Loyalists for the Lord's side, other Rebels for a Rebel."""
        my_role = game.players[me].role
        ally = Role.REBEL if my_role == Role.REBEL else Role.LOYALIST
        total = self._dealt(game, ally)
        dead = sum(1 for p in game.players if not p.alive and self._known_role(game, me, p.seat) == ally)
        return total - dead - (1 if my_role == ally else 0)

    @staticmethod
    def _pressure(game: Game) -> float:
        """Long games: players who never showed their colours become gradually suspect, so a
        player who just sits quietly can't stall the game forever."""
        return min(0.6, max(0, game.turn_number - 20) * 0.03)

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
        for name in ("indulgence", "supply_shortage"):
            if o := first(name):
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

        # 7b. Chain enemies together when we can set them alight; a Fire Attack on an enemy.
        if (o := first("iron_chain")) and self._has_elemental(game, me):
            loose = [s for s in self._enemies(game, me, o.candidates) if not game.players[s].chained]
            if loose:
                return Play(o.card_id, tuple(loose[: o.target_count]))
        if (o := first("fire_attack")) and len(p.hand) >= 3:
            es = [s for s in self._enemies(game, me, o.candidates)]
            if es:
                best = max(es, key=lambda s: (game.players[s].chained, self._burns(game, s), -game.players[s].hp))
                return Play(o.card_id, (best,))

        # 8. Strike the best target in range (a Wine first, unless we need it to survive).
        if by_name.get("strike"):
            play = self._strike_play(game, me, by_name["strike"])
            if play is not None:
                if (w := first("wine")) and p.hp > 1:
                    return Play(w.card_id)
                return play

        # 9. Group cards that favour our side.
        if (o := first("peach_garden")) and self._garden_worth(game, me):
            return Play(o.card_id)
        if (o := first("harvest")) and sum(self.rel(game, me, s) for s in self._alive(game)) > 0.5:
            return Play(o.card_id)
        if (o := first("lightning")) and p.hp >= 4 and sum(self.rel(game, me, s) for s in self._alive(game) if s != me) < -1:
            return Play(o.card_id)

        # 10. Trade in what's left over: recast an Iron Chain we have no use for, Weigh Options.
        if o := first("iron_chain"):
            return Play(o.card_id)  # no targets: recast
        return self._weigh(game, me, req)

    def _has_elemental(self, game: Game, me: int) -> bool:
        """Can we deal fire/thunder damage (to set off a chain)?"""
        p = game.players[me]
        if any(c.nature != "normal" or c.name == "fire_attack" for c in p.hand):
            return True
        w = game.equip_in(p, EquipSlot.WEAPON)
        return w is not None and w.name == "vermilion_fan" and any(c.name == "strike" for c in p.hand)

    @staticmethod
    def _burns(game: Game, seat: int) -> bool:
        armor = game.equip_in(game.players[seat], EquipSlot.ARMOR)
        return armor is not None and armor.name == "rattan_armor"

    def _blocked(self, game: Game, me: int, cid: int, seat: int) -> bool:
        """Would `seat`'s armor stop this Strike card?"""
        card = game.cards[cid]
        armor = game.equip_in(game.players[seat], EquipSlot.ARMOR)
        if armor is None or not game.armor_against(seat, me, card):
            return False
        if armor.name == "benevolent_shield":
            return card.is_black
        if armor.name == "rattan_armor":
            return card.nature == "normal"
        return False

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

        # The best target that one of our Strikes gets through to (armor can stop some:
        # Benevolent Shield black ones, Rattan Armor ordinary ones).
        for target in sorted(es, key=score, reverse=True):
            usable = [o for o in opts if target in o.candidates and not self._blocked(game, me, o.card_id, target)]
            if not usable:
                continue
            t = game.players[target]
            elemental_wanted = t.chained or self._burns(game, target)
            # fire/thunder for chained or rattan-armoured targets; otherwise save them
            pick = max(usable, key=lambda o: (game.cards[o.card_id].nature != "normal") == elemental_wanted)
            targets = [target]
            if pick.target_count > 1:
                targets += [s for s in es if s != target and s in pick.candidates][: pick.target_count - 1]
            return Play(pick.card_id, tuple(targets))
        return None

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
            play = self._active(game, me, opt)
            if play is not None and game.check_skill_use(p, opt.skill, list(play.cards), list(play.targets)) is None:
                return play
        for conv in req.conversions:
            play = self._convert_play(game, me, conv)
            if play is not None:
                return play
        return None

    def _active(self, game: Game, me: int, opt) -> Play | None:
        """When and how to use each active skill (weigh_options is saved for last: _weigh)."""
        p = game.players[me]
        s = opt.skill

        def cheap(n: int) -> tuple[int, ...]:
            return tuple(self._lowest(game, me, opt.cards, n))

        def weakest(seats) -> int:
            return min(seats, key=lambda t: (game.players[t].hp, self._hand_count(game, t)))

        if s == "open_hand":  # give spare cards to a friend; give 2 once to heal
            friends = self._friends(game, me, [c for c in opt.candidates if c != me])
            if not friends:
                return None
            given = p.turn_usage.get("_given", 0)
            n = max(0, len(p.hand) - game.hand_limit(p))
            if p.is_wounded and given < 2 and not p.turn_usage.get("_open_hand_healed"):
                n = max(n, 2 - given)
            n = min(n, len(opt.cards))
            if n <= 0:
                return None
            to = min(friends, key=lambda t: (self._hand_count(game, t), game.players[t].hp))
            return Play(skill=s, cards=cheap(n), targets=(to,))
        if s == "call_to_arms":  # our own Strikes first
            if any(c.name == "strike" for c in p.hand):
                return None
            es = self._enemies(game, me, opt.candidates)
            return Play(skill=s, targets=(es[0],)) if es else None
        if s == "bitter_gambit":
            peaches = sum(1 for c in p.hand if c.name == "peach")
            return Play(skill=s) if p.hp >= 3 or (p.hp == 2 and peaches) else None
        if s == "false_letter":
            es = self._enemies(game, me, opt.candidates)
            return Play(skill=s, targets=(weakest(es),)) if es and len(p.hand) >= 2 else None
        if s == "wedding_vow":
            pool = self._friends(game, me, opt.candidates)
            if not pool and p.is_wounded:
                pool = [t for t in opt.candidates if self.rel(game, me, t) > ENEMY]
            if not pool or (not p.is_wounded and len(p.hand) < 4):
                return None
            return Play(skill=s, cards=cheap(2), targets=(weakest(pool),))
        if s == "healing_herbs":
            pool = [t for t in opt.candidates if t == me or self.rel(game, me, t) >= FRIEND]
            return Play(skill=s, cards=cheap(1), targets=(weakest(pool),)) if pool else None
        if s == "rivalry":  # set someone on our weakest male enemy (ideally another enemy)
            es = self._enemies(game, me, opt.candidates)
            if not es:
                return None
            victim = weakest(es)
            attackers = [t for t in opt.candidates if t != victim]
            if not attackers:
                return None
            attacker = max(attackers, key=lambda t: (self.rel(game, me, t) <= ENEMY, self._hand_count(game, t)))
            return Play(skill=s, cards=cheap(1), targets=(attacker, victim))
        if s == "do_nothing_win":  # a free look at the deck for each aura token
            return Play(skill=s)
        if s == "whats_up_beijing":  # hide when hurt: nobody can reach us until our next turn
            return Play(skill=s) if p.hp <= 2 else None
        if s == "sharing":  # an enemy with the most cards hands one to a friend (or us) with the fewest
            counts = [self._hand_count(game, t) for t in self._alive(game)]
            hi, lo = max(counts), min(counts)
            givers = [t for t in opt.candidates if self._hand_count(game, t) == hi and self.rel(game, me, t) <= ENEMY]
            takers = [t for t in opt.candidates if self._hand_count(game, t) == lo and self.rel(game, me, t) >= FRIEND]
            pairs = [(a, b) for a in givers for b in takers if a != b]
            return Play(skill=s, targets=pairs[0]) if pairs else None
        if s == "tariffs":
            es = self._enemies(game, me, opt.candidates)
            return Play(skill=s, targets=(max(es, key=lambda t: self._hand_count(game, t)),)) if es else None
        if s == "baby_oil":  # a cheap card to make an enemy slip
            es = self._enemies(game, me, opt.candidates)
            if not es or self._value(game, me, cheap(1)[0]) > 4:
                return None
            return Play(skill=s, cards=cheap(1), targets=(max(es, key=lambda t: self._hand_count(game, t)),))
        if s == "deepseek":  # trade a weak card for the best of three
            return Play(skill=s, cards=cheap(1)) if self._value(game, me, cheap(1)[0]) <= 4 else None
        return None

    def _weigh(self, game: Game, me: int, req: PlayRequest) -> Play | None:
        """Swap junk for fresh cards at the end of the play phase."""
        opt = next((o for o in req.skills if o.skill == "weigh_options"), None)
        if opt is None:
            return None
        hand = {c.id for c in game.players[me].hand}
        junk = [c for c in opt.cards if c in hand and self._value(game, me, c) <= 3]
        return Play(skill="weigh_options", cards=tuple(junk)) if junk else None

    def _convert_play(self, game: Game, me: int, conv) -> Play | None:
        p = game.players[me]
        if conv.as_name in ("barbarians", "arrows") and self._aoe_worth(game, me):
            cards = self._conversion_cards(game, me, conv)
            return Play(skill=conv.skill, cards=cards) if cards is not None else None
        if conv.skill == "vermilion_fan":  # set fire to the chained or the rattan-armoured
            es = [s for s in self._enemies(game, me, conv.candidates) if game.players[s].chained or self._burns(game, s)]
            return Play(skill=conv.skill, cards=(conv.cards[0],), targets=(es[0],)) if es else None
        # one-card conversions: spend a card that's worth less than what it becomes
        single = self._lowest(game, me, conv.cards, 1) if conv.count == 1 else []
        if single and self._value(game, me, single[0]) >= 7:
            single = []
        if conv.as_name == "strike" and not any(c.name == "strike" for c in p.hand):
            es = self._enemies(game, me, conv.candidates)
            if not es:
                return None
            if single:
                return Play(skill=conv.skill, cards=tuple(single), targets=(es[0],))
            if conv.count == 2 and len(p.hand) >= 4:
                cards = self._conversion_cards(game, me, conv)
                return Play(skill=conv.skill, cards=cards, targets=(es[0],)) if cards is not None else None
        if conv.as_name == "dismantle" and single:
            target = self._dismantle_target(game, me, conv.candidates)
            return Play(skill=conv.skill, cards=tuple(single), targets=(target,)) if target is not None else None
        if conv.as_name == "harvest" and single and sum(self.rel(game, me, s) for s in self._alive(game)) > 0.5:
            return Play(skill=conv.skill, cards=tuple(single))
        if conv.as_name == "indulgence" and single:
            es = self._enemies(game, me, conv.candidates)
            if es:
                best = max(es, key=lambda s: (self._focus(game, me, s), self._hand_count(game, s), -self.rel(game, me, s)))
                return Play(skill=conv.skill, cards=tuple(single), targets=(best,))
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
        for conv in req.conversions:
            if conv.count == 1:  # e.g. a black card as a Dodge: as good as the real thing
                return Convert(conv.skill, tuple(self._lowest(game, me, conv.cards, 1)))
            if game.players[me].hp <= 2 or req.card_name == "nullify":  # worth spending 2 cards?
                cards = self._conversion_cards(game, me, conv)
                if cards is not None:
                    return Convert(conv.skill, cards)
        return None

    def _want_response(self, game: Game, me: int, req: RespondRequest) -> bool:
        name, reason = req.card_name, req.reason
        p = game.players[me]
        if reason in ASK_FOR_LORD:  # play it for the Lord?
            return self.rel(game, me, req.about) >= FRIEND
        if name == "dodge":
            return True
        if name == "peach":
            dying = req.about
            if dying == me:
                return True
            if game.players[me].role == Role.SPY and dying == game.lord_seat and self._rebels_left(game, me) > 0:
                return True
            return self.rel(game, me, dying) >= 0.5
        if name == "strike":
            if reason == "borrowed_sword":
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
        if req.reason == "false_letter":  # give a card of another suit (it hurts), cheapest first
            hurt = self.rel(game, me, req.about) <= ENEMY
            pool = [c for c in req.options if (str(game.cards[c].suit) != req.context.get("suit")) == hurt]
            return self._lowest(game, me, pool or req.options, 1)
        return self._lowest(game, me, req.options, req.count)

    def _bend_fate(self, game: Game, me: int, req: ChooseCardRequest) -> int | None:
        """Replace a judgment card when it turns the outcome our way."""
        ctx = req.context
        rule = JUDGE_RULES.get(ctx.get("judge_reason", ""))
        r = self.rel(game, me, ctx.get("seat"))
        if rule is None or -FRIEND < r < FRIEND:
            return None
        good_hit = ctx["judge_reason"] in GOOD_JUDGMENTS
        want_hit = good_hit if r >= FRIEND else not good_hit
        if ctx["would_hit"] == want_hit:
            return None
        fits = [cid for cid in req.options if rule(game.cards[cid].to_dict()) == want_hit]
        return self._lowest(game, me, fits, 1)[0] if fits else None

    def _arrange(self, game: Game, me: int, req: ArrangeRequest) -> tuple:
        """Stack the deck: first cards that defuse our pending judgments, then what we'd like
        to draw; the rest goes to the bottom."""
        faces = {c["id"]: c for c in req.cards}
        left, top = list(req.options), []
        for jc in reversed(game.players[me].judge):  # resolved last-placed first
            rule = JUDGE_RULES.get(game.judge_name(jc))
            pick = next((i for i in left if rule is not None and not rule(faces[i])), None)
            if pick is None:
                break
            top.append(pick)
            left.remove(pick)
        left.sort(key=lambda i: -self._value(game, me, i))
        keep = [i for i in left if self._value(game, me, i) >= 4]
        return (tuple(top + keep), tuple(i for i in left if i not in keep))

    def _distill(self, game: Game, me: int, req: ChooseCardRequest) -> int | None:
        """Copy another player's trick when the copy would help us (paying a spare basic card)."""
        name = req.context.get("card")
        others = [s for s in self._alive(game) if s != me]
        if name == "ex_nihilo":
            worth = True
        elif name in ("barbarians", "arrows"):
            worth = self._aoe_worth(game, me)
        elif name == "peach_garden":
            worth = self._garden_worth(game, me)
        elif name == "harvest":
            worth = sum(self.rel(game, me, s) for s in self._alive(game)) > 0.5
        elif name == "lightning":
            worth = False
        else:  # aimed at someone: only with an enemy to aim it at
            worth = bool(self._enemies(game, me, others))
        cheapest = self._lowest(game, me, req.options, 1)[0]
        return cheapest if worth and self._value(game, me, cheapest) <= 6 else None

    def _choose_card(self, game: Game, me: int, req: ChooseCardRequest) -> Any:
        if req.reason == "bend_fate":
            return self._bend_fate(game, me, req)
        if req.reason == "distillation":
            return self._distill(game, me, req)
        if req.reason == "fire_attack":
            if req.context.get("step") == "discard":  # pay a card to burn them, unless they're a friend
                return self._lowest(game, me, req.options, 1)[0] if self.rel(game, me, req.context.get("target")) < FRIEND else None
            return self._lowest(game, me, req.options, 1)[0]  # show our least useful card
        if req.about is None:  # harvest-style pick from revealed cards
            return max(req.options, key=lambda i: (self._value(game, me, i), -i))
        if req.about == me:  # giving away one of our own cards (or losing one: our own Frost
            # Blade through an Iron Chain, where only our face-down hand is on offer)
            return self._lowest(game, me, req.options, 1)[0] if req.options else HAND
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
        if req.reason in ("tit_for_tat", "blood_for_blood", "headlong_charge", "baby_oil"):
            return r < FRIEND  # aimed at the other player: not at a friend
        if req.reason == "tariffs":  # cash in a Tariff on an enemy (it costs us a card)
            return r <= ENEMY
        if req.reason == "spacex":  # launch with Strikes to fire
            return sum(1 for c in game.players[me].hand if c.name == "strike") >= 2
        if req.reason == "reckless_fury":
            return any(c.name in ("strike", "duel") for c in game.players[me].hand)
        return True  # eight_trigrams, guard the throne, profit from loss, rippling steps...

    def _choose_player(self, game: Game, me: int, req: ChoosePlayerRequest) -> int | None:
        if req.reason == "final_stratagem":  # the cards we were shown: keep them
            return me
        others = [s for s in req.options if s != me] or req.options
        es = self._enemies(game, me, others)
        if req.reason == "night_raid":  # rob whoever holds the most, never a friend
            pool = es or [s for s in others if self.rel(game, me, s) < FRIEND]
            return max(pool, key=lambda s: self._hand_count(game, s)) if pool else None
        if req.reason == "deflect":  # pass the Strike to an enemy, the weaker the better
            return min(es, key=lambda s: game.players[s].hp) if es else None
        if es:
            return es[0]
        if req.optional:
            return None
        return min(others, key=lambda s: self.rel(game, me, s))

    def _choose_option(self, game: Game, me: int, req: ChooseOptionRequest) -> str:
        p = game.players[me]
        r = self.rel(game, me, req.about)
        if req.reason == "blood_for_blood" and "discard_two" in req.choices:
            two = sum(sorted(self._value(game, me, c.id) for c in p.hand)[:2])
            return "discard_two" if p.hp <= 2 or two <= 8 else "take_damage"
        if req.reason == "false_letter":
            return self.rng.choice(req.choices)  # it can't see the cards: any suit is a guess
        if req.reason == "tariffs":  # one random card beats probably skipping a draw phase
            return "tariff_give" if "tariff_give" in req.choices else req.choices[0]
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
