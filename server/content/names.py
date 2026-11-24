"""Display names + rules text for clients, in English or Chinese.

Content ids stay English snake_case everywhere; only what players read is localized.
English comes from CARD_NAMES / class docstrings / Hero.name; Chinese from content/i18n.py.
"""
from __future__ import annotations

from typing import Any

from engine import ROLE_TABLE, EquipDef, Ruleset
from engine.hero import skill_info

from .heroes import GAINED_SKILLS
from .i18n import LANGS, ZH_CARDS, ZH_HEROES, ZH_SKILLS

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


# English skill titles that title-casing the id gets wrong (small words, apostrophes).
SKILL_NAMES: dict[str, str] = {
    "profit_from_loss": "Profit from Loss", "guard_the_throne": "Guard the Throne",
    "tit_for_tat": "Tit for Tat", "blood_for_blood": "Blood for Blood",
    "heavens_will": "Heaven's Will", "call_to_arms": "Call to Arms",
    "nothing_to_hide": "Nothing to Hide", "pirates_raid": "Pirate's Raid",
    "spoils_of_war": "Spoils of War",
}


def skill_title(skill_id: str) -> str:
    return SKILL_NAMES.get(skill_id) or skill_id.replace("_", " ").title()


def _clean(text: str) -> str:
    return " ".join(text.split())


def content_info(ruleset: Ruleset, lang: str = "en") -> dict[str, Any]:
    """Everything a client needs to render cards and heroes, in `lang` ("en" or "zh")."""
    if lang not in LANGS:
        lang = "en"
    zh = lang == "zh"
    cards = {}
    for name, d in ruleset.card_defs.items():
        title, text = CARD_NAMES.get(name, name), _clean(type(d).__doc__ or "")
        if zh and name in ZH_CARDS:
            title, text = ZH_CARDS[name]
        info: dict[str, Any] = {"title": title, "type": str(d.type), "text": text}
        if name in ZH_CARDS:
            info["zh"] = ZH_CARDS[name][0]  # always sent: seal / brush characters in both languages
        if isinstance(d, EquipDef):
            info["slot"] = str(d.slot)
            if d.attack_range is not None:
                info["range"] = d.attack_range
        cards[name] = info
    heroes = []
    skills: dict[str, dict[str, Any]] = {}
    for h in ruleset.heroes.values():
        hd = h.to_dict()
        hd["zh"] = ZH_HEROES.get(h.id, h.name)  # brush-character portraits in both languages
        if zh and h.id in ZH_HEROES:
            hd["name"] = ZH_HEROES[h.id]
        for s in hd["skills"]:
            s["title"], s["text"] = skill_title(s["id"]), _clean(s["text"])
            if s["id"] in ZH_SKILLS:
                s["zh"] = ZH_SKILLS[s["id"]][0]
            if zh and s["id"] in ZH_SKILLS:
                s["title"], s["text"] = ZH_SKILLS[s["id"]]
            skills[s["id"]] = s
        heroes.append(hd)
    # Skills gained mid-game (e.g. Seize Power) aren't on any hero's starting list.
    for skill in GAINED_SKILLS:
        s = skill_info(skill)
        s["title"], s["text"] = skill_title(s["id"]), _clean(s["text"])
        if s["id"] in ZH_SKILLS:
            s["zh"] = ZH_SKILLS[s["id"]][0]
        if zh and s["id"] in ZH_SKILLS:
            s["title"], s["text"] = ZH_SKILLS[s["id"]]
        skills.setdefault(s["id"], s)
    # Which roles a game of N players deals (the lobby shows it before you start).
    roles = {str(n): [str(r) for r in table] for n, table in ROLE_TABLE.items()}
    return {"lang": lang, "cards": cards, "heroes": heroes, "skills": skills, "roles": roles}
