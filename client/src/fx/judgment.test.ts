import { describe, expect, it } from "vitest";
import { judgmentGood } from "./judgment";

describe("judgment outcome colour", () => {
  it("a delayed trick hitting is bad news for the judged player; its miss is good", () => {
    for (const r of ["indulgence", "supply_shortage", "lightning"]) {
      expect(judgmentGood(r, true)).toBe(false);
      expect(judgmentGood(r, false)).toBe(true);
    }
  });

  it("judgments a player asks for (armour, hero skills) are good news when they hit", () => {
    for (const r of ["eight_trigrams", "rippling_steps", "blood_for_blood", "headlong_charge"]) {
      expect(judgmentGood(r, true)).toBe(true);
      expect(judgmentGood(r, false)).toBe(false);
    }
  });
});
