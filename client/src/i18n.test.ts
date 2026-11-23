import { afterEach, describe as group, expect, it } from "vitest";
import { setContent } from "./content";
import { describe } from "./describe";
import { _DICTS_FOR_TESTS, _setLangForTests, memberName as i18nMemberName, serverText, t } from "./i18n";
import { respondText } from "./components/ActionBar";
import type { RespondReq } from "./types";

afterEach(() => _setLangForTests("en"));

const zhContent = {
  lang: "zh",
  cards: { strike: { title: "击", type: "basic" as const, text: "" }, dodge: { title: "闪", type: "basic" as const, text: "" } },
  heroes: [],
  skills: { iron_edict: { id: "iron_edict", tags: [], text: "", title: "铁令" } },
};

group("translation basics", () => {
  it("fills placeholders in both languages", () => {
    expect(t("table.turn", { n: 3 })).toBe("Turn 3");
    _setLangForTests("zh");
    expect(t("table.turn", { n: 3 })).toBe("第3回合");
  });

  it("every Chinese string is filled in and keeps the English placeholders", () => {
    // `zh` is typed against `en`, so a missing key already fails the TS build; this also
    // catches empty strings, dropped {placeholders}, and English left untranslated.
    const { en, zh } = _DICTS_FOR_TESTS;
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    const sameOk = new Set(["act.convert", "log.to"]); // only placeholders / symbols
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(zh[key], key).toBeTruthy();
      expect(vars(zh[key]), key).toEqual(vars(en[key]));
      if (!sameOk.has(key)) expect(zh[key], `${key} looks untranslated`).not.toBe(en[key]);
    }
  });

  it("shows bot names in the current language, human names untouched", () => {
    expect(i18nMemberName({ name: "Bot 3", bot: true }, 2)).toBe("Bot 3");
    _setLangForTests("zh");
    expect(i18nMemberName({ name: "Bot 3", bot: true }, 2)).toBe("电脑3");
    expect(i18nMemberName({ name: "Bot 3", bot: false }, 2)).toBe("Bot 3"); // a human called "Bot 3"
    expect(i18nMemberName({ name: "小明", bot: false }, 0)).toBe("小明");
    expect(i18nMemberName(undefined, 4)).toBe("玩家5");
  });

  it("translates known server errors and wraps unknown ones", () => {
    expect(serverText("the room is full")).toBe("The room is full.");
    _setLangForTests("zh");
    expect(serverText("the room is full")).toBe("房间已满。");
    expect(serverText("need 4-8 players")).toBe("需要4-8名玩家。");
    expect(serverText("choose exactly 1 target(s)")).toContain("choose exactly 1 target(s)");
  });
});

group("game text in Chinese", () => {
  it("log lines use Chinese wording and card names", () => {
    _setLangForTests("zh");
    setContent(zhContent);
    const name = (s: number | null | undefined) => `玩家${s}`;
    const strike = { id: 1, name: "strike", suit: "spade" as const, rank: 7 };
    expect(describe({ type: "use", seat: 0, card: strike, targets: [2] }, name)?.text).toBe("玩家0使用了击 ♠7 → 玩家2");
    expect(describe({ type: "damage", source: 0, target: 2, amount: 1, nature: "fire", hp: 2 }, name)?.text).toBe(
      "玩家2受到玩家0造成的1点火焰伤害（体力2）",
    );
    expect(describe({ type: "death", seat: 1, role: "rebel" }, name)?.text).toBe("玩家1阵亡，身份是反贼");
    expect(describe({ type: "skill", seat: 0, skill: "iron_edict", targets: [] }, name)?.text).toBe("玩家0发动了铁令");
  });

  it("prompts are translated", () => {
    _setLangForTests("zh");
    setContent(zhContent);
    const req: RespondReq = {
      kind: "respond", seat: 1, error: null, card_name: "dodge", reason: "strike", about: 0,
      options: [5], conversions: [], context: {},
    };
    expect(respondText(req, (s) => (s === 0 ? "小明" : "你"), 1)).toBe("小明对你使用了击，是否打出闪？");
  });
});
