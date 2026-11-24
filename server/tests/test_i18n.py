"""Every card, hero and skill must be playable in English AND Chinese.

If one of these fails after adding content, add its Chinese entry to content/i18n.py.
"""
import re

from fastapi.testclient import TestClient

from content.heroes import GAINED_SKILLS, HEROES
from content.i18n import ZH_CARDS, ZH_HEROES, ZH_SKILLS
from content.names import CARD_NAMES, content_info
from content.standard import STANDARD
from net.app import create_app
from net.room import Settings

HAS_CJK = re.compile(r"[一-鿿]")
ALL_SKILLS = {s.name for h in HEROES for s in h.skills} | {s.name for s in GAINED_SKILLS}


def test_every_card_has_english_and_chinese():
    for name, d in STANDARD.card_defs.items():
        assert name in CARD_NAMES, f"no English name for card {name!r}"
        assert (type(d).__doc__ or "").strip(), f"no English rules text for card {name!r}"
        assert name in ZH_CARDS, f"no Chinese entry for card {name!r} in content/i18n.py"
        title, text = ZH_CARDS[name]
        assert title and HAS_CJK.search(text), f"Chinese entry for {name!r} looks empty"


def test_every_hero_and_skill_has_chinese():
    for h in HEROES:
        assert h.id in ZH_HEROES, f"no Chinese name for hero {h.id!r}"
    for skill in ALL_SKILLS:
        assert skill in ZH_SKILLS, f"no Chinese entry for skill {skill!r} in content/i18n.py"
        assert HAS_CJK.search(ZH_SKILLS[skill][1])


def test_no_stale_translations():
    assert set(ZH_CARDS) <= set(STANDARD.card_defs)
    assert set(ZH_HEROES) <= {h.id for h in HEROES}
    assert set(ZH_SKILLS) <= ALL_SKILLS


def test_content_info_in_both_languages():
    en, zh = content_info(STANDARD, "en"), content_info(STANDARD, "zh")
    assert en["lang"] == "en" and zh["lang"] == "zh"
    assert en["cards"]["strike"]["title"] == "Strike" and zh["cards"]["strike"]["title"] == "击"
    assert en["cards"].keys() == zh["cards"].keys()
    wei = {h["id"]: h for h in zh["heroes"]}["wei_lie"]
    assert wei["name"] == "魏烈" and wei["skills"][0]["title"] == "战利"
    assert en["skills"]["star_chart"]["text"] and zh["skills"]["star_chart"]["title"] == "星图"
    assert en["skills"]["heavens_will"]["title"] == "Heaven's Will"  # nicer than title-casing the id
    assert content_info(STANDARD, "klingon")["lang"] == "en"
    # Chinese names travel in both languages (seal / brush characters in the UI).
    assert en["cards"]["indulgence"]["zh"] == "乐不思蜀" and en["skills"]["bend_fate"]["zh"] == "改命"
    assert {h["id"]: h for h in en["heroes"]}["cao_cao"]["zh"] == "曹操"
    # role table for the lobby: one Lord, one Spy, the rest split
    assert en["roles"]["5"] == ["lord", "loyalist", "rebel", "rebel", "spy"]
    assert set(en["roles"]) == {"4", "5", "6", "7", "8"}


def test_content_endpoint_language_param():
    with TestClient(create_app(Settings())) as client:
        assert client.get("/api/content?lang=zh").json()["cards"]["peach"]["title"] == "桃"
        assert client.get("/api/content").json()["cards"]["peach"]["title"] == "Peach"
        assert client.get("/api/content?lang=xx").json()["lang"] == "en"
