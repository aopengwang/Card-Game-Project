"""A dumb-but-legal bot that only uses public info + its own role. For tests and empty seats."""
from __future__ import annotations

import random
from typing import Any

from engine import (
    HAND,
    ChooseCardRequest,
    ChooseHeroRequest,
    ChoosePlayerRequest,
    ConfirmRequest,
    Convert,
    DiscardRequest,
    EquipDef,
    Game,
    Play,
    Player,
    PlayOption,
    PlayRequest,
    Request,
    RespondRequest,
    Role,
)

HARMFUL = {
    "dismantle", "snatch", "duel", "barbarians", "arrows", "indulgence", "lightning", "borrowed_sword",
    "fire_attack", "supply_shortage", "iron_chain",
}
EQUIPMENT = [
    "crossbow", "piercing_sword", "twin_swords", "frost_blade", "dragon_glaive", "stone_axe",
    "serpent_spear", "halberd", "kirin_bow", "ancient_blade", "vermilion_fan", "eight_trigrams",
    "benevolent_shield", "silver_lion", "rattan_armor", "plus_horse", "minus_horse",
]
# Cards the bot plays first -> last. Targeted ones need an enemy among candidates.
PLAY_ORDER = [
    "peach", *EQUIPMENT, "ex_nihilo", "harvest", "peach_garden", "snatch", "dismantle",
    "indulgence", "supply_shortage", "borrowed_sword", "duel", "fire_attack", "iron_chain",
    "barbarians", "arrows", "wine", "strike", "lightning",
]
DECLINE = {"frost_blade"}  # optional effects the bot never uses (it prefers dealing damage)
GOOD_JUDGMENTS = {"eight_trigrams", "rippling_steps", "blood_for_blood", "headlong_charge"}  # a hit is good for the judged player
PICK_ORDER = ["peach", "nullify", "ex_nihilo", "dodge", "snatch", "duel", "strike"]
ASK_FOR_LORD = {"shield_wall", "guard_the_throne", "call_to_arms"}  # the Lord asks others to play a card for them
# Active skills this bot leaves alone: they need judgment it doesn't have.
SKIP_SKILLS = {"open_hand", "weigh_options"}


class SimpleBot:
    def __init__(self, seed: int = 0):
        self.rng = random.Random(seed)

    def __call__(self, game: Game, req: Request) -> Any:
        me = game.players[req.seat]
        if isinstance(req, PlayRequest):
            return self._play(game, me, req)
        if isinstance(req, RespondRequest):
            return self._respond(game, me, req)
        if isinstance(req, ChooseCardRequest):
            return self._choose(game, req)
        if isinstance(req, DiscardRequest):
            return self.rng.sample(req.options, req.count)
        if isinstance(req, ConfirmRequest):
            if req.reason == "omen":
                return self._omen(game, me, req)
            return req.reason not in DECLINE
        if isinstance(req, ChooseHeroRequest):
            return self.rng.choice(req.options)
        if isinstance(req, ChoosePlayerRequest):
            if req.reason == "final_stratagem":
                return me.seat if me.seat in req.options else req.options[0]
            others = [s for s in req.options if s != me.seat] or req.options
            enemies = self._enemies(game, me, others)
            if req.optional:
                return self.rng.choice(enemies) if enemies else None
            return self.rng.choice(enemies or others)
        return req.default()

    # ------------------------------------------------------------ helpers

    def _enemies(self, game: Game, me: Player, cands: list[int]) -> list[int]:
        lord = game.lord_seat
        not_lord = [c for c in cands if c != lord]
        match me.role:
            case Role.REBEL:
                return [lord] if lord in cands else cands
            case Role.LOYALIST:
                return not_lord
            case Role.SPY:
                return cands if len(game.alive_players()) <= 2 else not_lord
            case _:
                return cands

    def _is_friend(self, game: Game, me: Player, seat: int | None) -> bool:
        if seat is None:
            return False
        if seat == me.seat:
            return True
        lord_side = me.role in (Role.LORD, Role.LOYALIST)
        return lord_side and seat == game.lord_seat

    # ------------------------------------------------------------ decisions

    def _omen(self, game: Game, me: Player, req: ConfirmRequest) -> bool:
        """Rejudge when the current outcome is bad for a friend."""
        good_hit = req.context["judge_reason"] in GOOD_JUDGMENTS
        good_for_them = req.context["would_hit"] == good_hit
        return self._is_friend(game, me, req.about) and not good_for_them

    def _skill_play(self, game: Game, me: Player, req: PlayRequest) -> Play | None:
        """Try active skills and play-phase conversions with random legal picks."""
        for opt in req.skills:
            if opt.skill in SKIP_SKILLS or (opt.skill == "bitter_gambit" and me.hp < 3):
                continue
            cands = list(opt.candidates)
            harmful = getattr(game.find_skill(me, opt.skill), "harmful", True)
            pool = self._enemies(game, me, cands) if harmful else [c for c in cands if self._is_friend(game, me, c)]
            if len(pool) < opt.min_targets:
                continue
            for _ in range(10):
                n = max(opt.min_targets, min(len(pool), opt.target_count)) if harmful else opt.min_targets
                targets = tuple(self.rng.sample(pool, n))
                cards = tuple(self.rng.sample(opt.cards, opt.min_cards))
                if game.check_skill_use(me, opt.skill, list(cards), list(targets)) is None:
                    return Play(skill=opt.skill, cards=cards, targets=targets)
        for conv in req.conversions:
            if conv.as_name in ("barbarians", "arrows") and me.role == Role.LOYALIST:
                continue
            if conv.target_count:  # targeted conversions (e.g. 2 cards as a Strike): keep cards
                continue
            for _ in range(10):
                cards = tuple(self.rng.sample(conv.cards, conv.count))
                if game.check_skill_use(me, conv.skill, list(cards), []) is None:
                    return Play(skill=conv.skill, cards=cards)
        return None

    def _play(self, game: Game, me: Player, req: PlayRequest) -> Play | None:
        skill_play = self._skill_play(game, me, req)
        if skill_play is not None:
            return skill_play
        by_name: dict[str, list[PlayOption]] = {}
        for opt in req.options.values():
            by_name.setdefault(game.cards[opt.card_id].name, []).append(opt)
        for name in PLAY_ORDER:
            for opt in by_name.get(name, []):
                if name in ("barbarians", "arrows") and me.role == Role.LOYALIST:
                    continue  # would hurt the lord
                if name == "peach_garden" and not me.is_wounded:
                    continue
                if name == "wine" and "strike" not in by_name:
                    continue  # only worth it before a Strike
                d = game.card_def(game.cards[opt.card_id])
                if isinstance(d, EquipDef) and game.equip_in(me, d.slot) is not None:
                    continue  # keep what's already equipped
                if opt.target_count == 0:
                    return Play(opt.card_id)
                targets = self._enemies(game, me, list(opt.candidates))
                if targets:
                    n = min(len(targets), opt.target_count)
                    return Play(opt.card_id, tuple(self.rng.sample(targets, n)))
        return None

    def _respond(self, game: Game, me: Player, req: RespondRequest) -> Any:
        if not req.options:  # only a conversion (e.g. 2 cards as a Strike) is possible
            conv = req.conversions[0]
            pick = self._respond(game, me, RespondRequest(
                seat=req.seat, card_name=req.card_name, reason=req.reason, about=req.about,
                options=[-1], context=req.context,
            ))
            return Convert(conv.skill, conv.cards[: conv.count]) if pick is not None else None
        if req.reason in ASK_FOR_LORD:  # spend a card for the Lord only if we're on their side
            return req.options[0] if self._is_friend(game, me, req.about) else None
        if req.card_name == "strike" and req.reason in ("borrowed_sword", "dragon_glaive"):
            return req.options[0] if not self._is_friend(game, me, req.about) else None
        if req.card_name == "peach":
            dying = req.about
            helps = (
                dying == me.seat
                or (me.role == Role.LOYALIST and dying == game.lord_seat)
                or (me.role == Role.SPY and dying == game.lord_seat and len(game.alive_players()) > 2)
            )
            return req.options[0] if helps else None
        if req.card_name == "nullify":
            # Only meddle for yourself/your lord: cancel harmful effects, restore helpful ones.
            ctx = req.context
            if not self._is_friend(game, me, ctx["target"]):
                return None
            want_cancelled = ctx["card"]["name"] in HARMFUL
            return req.options[0] if want_cancelled != ctx["cancelled"] else None
        return req.options[0]

    def _choose(self, game: Game, req: ChooseCardRequest) -> Any:
        if req.optional and req.about == req.seat:  # e.g. replacing a judgment card: don't bother
            return None
        if req.about is None:  # harvest: pick the best revealed card
            names = {cid: game.cards[cid].name for cid in req.options}
            return min(req.options, key=lambda c: PICK_ORDER.index(names[c]) if names[c] in PICK_ORDER else 99)
        # Taking from an enemy: prefer their hand.
        return HAND if req.hidden_count else req.options[0]
