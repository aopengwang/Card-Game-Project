import { useSyncExternalStore } from "react";

/*
 * Table sounds, synthesized with Web Audio (no audio files: small, ours, and in key with
 * each other). Paper and wood for cards, a temple bell for your turn, a gong for a fall.
 * Volume and mute live in Settings and are remembered per browser.
 *
 * Browsers only allow audio after the player interacts with the page, so the audio
 * context starts on the first click or key press; sounds before that are skipped.
 */
export type SoundName =
  | "card"
  | "equip"
  | "select"
  | "tick"
  | "tickLast"
  | "damage"
  | "heal"
  | "turn"
  | "slam"
  | "emote"
  | "judgeGood"
  | "judgeBad"
  | "death"
  | "victory"
  | "defeat";

const KEY = "sgs.sound";
type Prefs = { volume: number; muted: boolean };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    if (p) return { volume: Math.min(1, Math.max(0, Number(p.volume ?? 0.6))), muted: !!p.muted };
  } catch {
    // storage blocked or bad JSON: defaults
  }
  return { volume: 0.6, muted: false };
}

let prefs = loadPrefs();
const listeners = new Set<() => void>();

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = prefs.muted ? 0 : prefs.volume;
  master.connect(ctx.destination);
  return ctx;
}

/** Start audio on the first interaction (browser autoplay rules). Call once at startup. */
export function initSound(): void {
  const unlock = () => {
    const c = audio();
    if (c && c.state !== "running") void c.resume();
    if (c?.state === "running") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

// ---------------------------------------------------------------- building blocks

/** A tone with an attack/decay envelope. `bend` glides the pitch to that frequency. */
function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine", bend?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (bend) o.frequency.exponentialRampToValueAtTime(bend, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master!);
  o.start(at);
  o.stop(at + dur + 0.05);
}

let noiseBuf: AudioBuffer | null = null;
/** A burst of filtered noise (paper, cloth, impacts). */
function noise(c: AudioContext, at: number, dur: number, gain: number, from: number, to: number, q = 0.9) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = q;
  f.frequency.setValueAtTime(from, at);
  f.frequency.exponentialRampToValueAtTime(to, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(at);
  src.stop(at + dur + 0.05);
}

/** A struck bell or gong: inharmonic partials that decay at different rates. */
function bell(c: AudioContext, at: number, freq: number, dur: number, gain: number, partials: [number, number][]) {
  for (const [ratio, level] of partials) tone(c, at, freq * ratio, dur / Math.sqrt(ratio), gain * level);
}

// pentatonic notes (Hz)
const N = { D4: 293.7, E4: 329.6, G4: 392, A4: 440, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, C6: 1046.5, E6: 1318.5, A6: 1760 };

const SOUNDS: Record<SoundName, (c: AudioContext, t: number) => void> = {
  // a card slid onto the table: paper swish + a soft wooden tap
  card: (c, t) => {
    noise(c, t, 0.14, 0.32, 3200, 900);
    tone(c, t + 0.07, 190, 0.08, 0.18, "triangle", 120);
  },
  // gear fastened on: a metallic clink
  equip: (c, t) => {
    tone(c, t, 2200, 0.25, 0.12);
    tone(c, t + 0.02, 3310, 0.18, 0.08);
    noise(c, t, 0.05, 0.12, 5000, 3000, 2);
  },
  // picking up a card: a tiny paper tick
  select: (c, t) => noise(c, t, 0.05, 0.16, 4500, 2500, 1.5),
  // the countdown's last seconds: woodblock, higher on the final one
  tick: (c, t) => tone(c, t, 1150, 0.06, 0.22, "triangle", 900),
  tickLast: (c, t) => tone(c, t, 1550, 0.09, 0.28, "triangle", 1200),
  // a hit: low thud and a crack
  damage: (c, t) => {
    tone(c, t, 150, 0.3, 0.7, "sine", 48);
    noise(c, t, 0.08, 0.35, 1400, 500);
  },
  // healing: two jade chimes
  heal: (c, t) => {
    bell(c, t, N.E6, 0.6, 0.12, [[1, 1], [2.76, 0.3]]);
    bell(c, t + 0.11, N.A6, 0.7, 0.1, [[1, 1], [2.76, 0.3]]);
  },
  // your turn: a small temple bell
  turn: (c, t) => bell(c, t, N.C5, 1.6, 0.22, [[1, 1], [2, 0.5], [2.76, 0.35], [5.4, 0.15]]),
  // a killing blow lands: a heavy body-blow thump and a crack
  slam: (c, t) => {
    tone(c, t, 95, 0.55, 0.95, "sine", 34);
    tone(c, t, 190, 0.14, 0.4, "triangle", 70);
    noise(c, t, 0.22, 0.55, 2400, 260, 0.7);
  },
  // an emote pops up: a light two-note woodblock
  emote: (c, t) => {
    tone(c, t, 880, 0.09, 0.12, "triangle", 760);
    tone(c, t + 0.07, 1320, 0.11, 0.1, "triangle", 1180);
  },
  // a judgment goes your way: the seal's tap, then a rising pair of jade chimes
  judgeGood: (c, t) => {
    noise(c, t, 0.06, 0.3, 1800, 700);
    bell(c, t + 0.04, N.A5, 0.7, 0.12, [[1, 1], [2.76, 0.3]]);
    bell(c, t + 0.15, N.E6, 0.9, 0.11, [[1, 1], [2.76, 0.3]]);
  },
  // a judgment goes against you: the seal thuds down over a low, falling drum
  judgeBad: (c, t) => {
    tone(c, t, 120, 0.4, 0.6, "sine", 52);
    noise(c, t, 0.12, 0.4, 1600, 300);
    tone(c, t + 0.05, N.E4, 0.5, 0.09, "triangle", N.D4 * 0.7);
  },
  // a player falls: a deep gong
  death: (c, t) => {
    bell(c, t, 98, 2.6, 0.45, [[1, 1], [1.48, 0.6], [2.2, 0.4], [3.3, 0.2]]);
    noise(c, t, 0.4, 0.12, 400, 120);
  },
  victory: (c, t) => [N.C5, N.D5, N.E5, N.G5, N.A5, N.C6].forEach((f, i) => tone(c, t + i * 0.11, f, 0.5, 0.16, "triangle")),
  defeat: (c, t) => [N.A4, N.G4, N.E4, N.D4].forEach((f, i) => tone(c, t + i * 0.2, f, 0.7, 0.13, "triangle")),
};

/** Play a sound now (or `delay` seconds from now). Silent when muted or not yet unlocked. */
export function play(name: SoundName, delay = 0): void {
  if (prefs.muted || prefs.volume === 0) return;
  const c = audio();
  if (!c || c.state !== "running") return;
  SOUNDS[name](c, c.currentTime + 0.01 + delay);
  // test hook: what played (browser tests check the right sounds fire)
  const w = window as unknown as { __sgsSounds?: string[] };
  (w.__sgsSounds ??= []).push(name);
  if (w.__sgsSounds.length > 100) w.__sgsSounds.shift();
}

/**
 * A kill streak of `level` kills: one war-drum beat per kill (in time with the banner's
 * marks), then a gong that rises with the streak; from five kills a brass blare joins in,
 * and seven brings a full fanfare.
 */
export function playStreak(level: number, delay = 0.26): void {
  if (prefs.muted || prefs.volume === 0) return;
  const c = audio();
  if (!c || c.state !== "running") return;
  const t0 = c.currentTime + 0.01 + delay;
  const beat = 0.11;
  for (let i = 0; i < level; i++) {
    const at = t0 + i * beat;
    tone(c, at, 72 + i * 7, 0.34, 0.85, "sine", 38); // the drum's body
    noise(c, at, 0.07, 0.35, 900, 300); // the skin
  }
  const hit = t0 + level * beat + 0.05;
  bell(c, hit, 98 * Math.pow(1.122, level - 2), 2.6, 0.38 + level * 0.03, [[1, 1], [1.48, 0.6], [2.2, 0.4], [3.3, 0.2]]);
  noise(c, hit, 0.5, 0.18, 500, 120);
  if (level >= 5) {
    const root = level >= 7 ? N.A4 : N.E4;
    [1, 1.5, 2].forEach((r, i) => tone(c, hit + 0.02 * i, root * r, 0.9 + level * 0.08, 0.1, "sawtooth"));
  }
  if (level >= 7) [N.C5, N.E5, N.A5, N.C6].forEach((f, i) => tone(c, hit + 0.35 + i * 0.09, f, 0.8, 0.12, "triangle"));
  const w = window as unknown as { __sgsSounds?: string[] };
  (w.__sgsSounds ??= []).push(`streak${level}`);
  if (w.__sgsSounds.length > 100) w.__sgsSounds.shift();
}

/** Play a batch (several log entries at once): each distinct sound once, staggered. */
export function playAll(names: SoundName[]): void {
  [...new Set(names)].forEach((n, i) => play(n, i * 0.07));
}

// ---------------------------------------------------------------- settings

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // not remembered, fine
  }
  if (master && ctx) master.gain.setTargetAtTime(prefs.muted ? 0 : prefs.volume, ctx.currentTime, 0.02);
  listeners.forEach((l) => l());
}

export function setVolume(v: number): void {
  prefs = { ...prefs, volume: Math.min(1, Math.max(0, v)), muted: v > 0 ? false : prefs.muted };
  save();
}

export function setMuted(muted: boolean): void {
  prefs = { ...prefs, muted };
  save();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSoundPrefs(): Prefs {
  return useSyncExternalStore(subscribe, () => prefs);
}
