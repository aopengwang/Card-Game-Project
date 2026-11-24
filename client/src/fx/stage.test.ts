import { describe, expect, it } from "vitest";
import { Stage } from "./stage";

/** A moment that records when it starts and ends, and finishes when told to. */
function moment(name: string, log: string[]) {
  let finish = () => {};
  return {
    finish: () => finish(),
    m: {
      run: () =>
        new Promise<void>((done) => {
          log.push(`${name} start`);
          finish = () => {
            log.push(`${name} end`);
            done();
          };
        }),
      skip: () => log.push(`${name} skipped`),
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("stage", () => {
  it("plays big moments one at a time, in order", async () => {
    const log: string[] = [];
    const stage = new Stage();
    const a = moment("a", log);
    const b = moment("b", log);
    stage.add(a.m);
    stage.add(b.m);
    await tick();
    expect(log).toEqual(["a start"]);
    a.finish();
    await tick();
    expect(log).toEqual(["a start", "a end", "b start"]);
    b.finish();
    await tick();
    const c = moment("c", log);
    stage.add(c.m); // an idle stage starts the next moment at once
    await tick();
    expect(log.at(-1)).toBe("c start");
  });

  it("skips a backlog rather than replaying it long after, and clear skips what waits", async () => {
    const log: string[] = [];
    const stage = new Stage(1);
    const [a, b, c] = ["a", "b", "c"].map((n) => moment(n, log));
    stage.add(a.m);
    stage.add(b.m); // waits
    stage.add(c.m); // one is already waiting: dropped
    await tick();
    expect(log).toEqual(["a start", "c skipped"]);
    stage.clear();
    expect(log).toEqual(["a start", "c skipped", "b skipped"]);
    a.finish();
    await tick();
    expect(log.at(-1)).toBe("a end");
  });
});
