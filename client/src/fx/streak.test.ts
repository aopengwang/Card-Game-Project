import { describe, expect, it } from "vitest";
import { MAX_STREAK, streakAt } from "./streak";

const death = (seat: number, killer: number | null) => ({ type: "death", seat, killer, role: "rebel" });

describe("kill streaks", () => {
  it("count each player's kills so far; deaths without a killer (or self-inflicted) aren't kills", () => {
    const log = [
      death(1, 0),
      { type: "turn_start", seat: 2 },
      death(3, 2),
      death(4, 0),
      death(5, null), // Lightning
      death(6, 6), // self-inflicted
      death(7, 0),
    ];
    expect(log.map((_, i) => streakAt(log, i))).toEqual([1, 0, 1, 2, 0, 0, 3]);
  });

  it("tops out at seven (the most an 8-player game allows)", () => {
    const log = Array.from({ length: 9 }, (_, i) => death(i + 1, 0));
    expect(streakAt(log, 6)).toBe(7);
    expect(streakAt(log, 8)).toBe(MAX_STREAK);
  });
});
