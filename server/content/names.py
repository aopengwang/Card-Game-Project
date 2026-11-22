"""Display names + rules text for clients (content ids stay English snake_case)."""
from __future__ import annotations

from typing import Any

from engine import EquipDef, Ruleset

CARD_NAMES: dict[str, str] = {
    "strike": "Strike", "dodge": "Dodge", "peach": "Peach",
    "ex_nihilo": "Something from Nothing", "dismantle": "Dismantle", "snatch": "Snatch",
    "duel": "Duel", "barbarians": "Barbarian Invasion", "arrows": "Arrow Barrage",
    "peach_garden": "Peach Garden", "harvest": "Bountiful Harvest", "nullify": "Nullify",
    "borrowed_sword": "Borrowed Sword", "indulgence": "Indulgence", "lightning": "Lightning",
    "crossbow": "Repeating Crossbow", "piercing_sword": "Piercing Sword", "twin_swords": "Twin Swords",
    "frost_blade": "Frost Blade", "dragon_glaive": "Dragon Glaive", "stone_axe": "Stone Axe",
    "serpent_spear": "Serpent Spear", "halberd": "Sky Halberd", "kirin_bow": "Kirin Bow",
    "eight_trigrams": "Eight Trigrams", "benevolent_shield": "Benevolent Shield",
    "plus_horse": "+1 Horse", "minus_horse": "-1 Horse",
}


def skill_title(skill_id: str) -> str:
    return skill_id.replace("_", " ").title()


def content_info(ruleset: Ruleset) -> dict[str, Any]:
    """Everything a client needs to render cards and heroes."""
    cards = {}
    for name, d in ruleset.card_defs.items():
        info: dict[str, Any] = {
            "title": CARD_NAMES.get(name, name),
            "type": str(d.type),
            "text": " ".join((type(d).__doc__ or "").split()),
        }
        if isinstance(d, EquipDef):
            info["slot"] = str(d.slot)
            if d.attack_range is not None:
                info["range"] = d.attack_range
        cards[name] = info
    heroes = []
    for h in ruleset.heroes.values():
        hd = h.to_dict()
        for s in hd["skills"]:
            s["title"] = skill_title(s["id"])
            s["text"] = " ".join(s["text"].split())
        heroes.append(hd)
    return {"cards": cards, "heroes": heroes}
