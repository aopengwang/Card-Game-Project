/*
 * Big table moments (a killing blow) take the stage one at a time: each waits for the one
 * before it to finish. Small effects (flights, numbers) don't queue; they play at once.
 * The server never waits for animations, so a queued moment plays a little behind the
 * game; a backlog beyond `max` is skipped rather than replayed long after it happened.
 */

let speed = 1;

/** Effect speed: 1 in games; the animation lab plays them slower. */
export const fxSpeed = (): number => speed;

export function setFxSpeed(s: number): void {
  speed = s;
  // CSS effect durations are written as `calc(<ms> * var(--fx-slow, 1))`
  document.documentElement.style.setProperty("--fx-slow", String(1 / s));
}

export interface Moment {
  run: () => Promise<void>;
  /** Called instead of run when the moment is dropped, so it can undo any setup. */
  skip: () => void;
}

export class Stage {
  private queue: Moment[] = [];
  private playing = false;

  constructor(private readonly max = 3) {}

  add(m: Moment): void {
    if (this.queue.length >= this.max) {
      m.skip();
      return;
    }
    this.queue.push(m);
    if (!this.playing) void this.next();
  }

  /** Drop everything still waiting (the moment on stage finishes by itself). */
  clear(): void {
    const dropped = this.queue;
    this.queue = [];
    dropped.forEach((m) => m.skip());
  }

  private async next(): Promise<void> {
    const m = this.queue.shift();
    this.playing = !!m;
    if (!m) return;
    try {
      await m.run();
    } catch {
      m.skip();
    }
    void this.next();
  }
}
