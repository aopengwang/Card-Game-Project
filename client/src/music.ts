import { useSyncExternalStore } from "react";
import { onSoundChange, soundMuted } from "./sound";

/*
 * Background music: the audio files in client/public/music (listed by the server's
 * /api/music). Each player picks their own in Settings: off, one track on repeat, or all of
 * them in turn. Remembered per browser; the mute button silences it along with the effects.
 */
export type Track = { id: string; name: string; url: string };
export const OFF = "off";
export const ALL = "all";

type Prefs = { choice: string; volume: number }; // choice: OFF, ALL or a track id
export type MusicState = Prefs & { tracks: Track[] };

const KEY = "sgs.music";
const DEFAULTS: Prefs = { choice: OFF, volume: 0.4 };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Prefs> | null;
    if (p) {
      const volume = Number(p.volume ?? DEFAULTS.volume);
      return { choice: typeof p.choice === "string" ? p.choice : OFF, volume: Math.min(1, Math.max(0, volume)) };
    }
  } catch {
    // storage blocked or bad JSON: defaults
  }
  return DEFAULTS;
}

let state: MusicState = { ...loadPrefs(), tracks: [] };
const listeners = new Set<() => void>();

let el: HTMLAudioElement | null = null;
let inTurn: string | null = null; // "play all": the track whose turn it is
let failures = 0; // unplayable files in a row (so "play all" can't spin on them)

/** The track to play after `id`, wrapping round. */
export function nextTrack(tracks: Track[], id: string | null): Track | undefined {
  const i = tracks.findIndex((t) => t.id === id);
  return tracks[(i + 1) % tracks.length];
}

function wanted(): Track | undefined {
  if (state.choice === OFF) return undefined;
  if (state.choice !== ALL) return state.tracks.find((t) => t.id === state.choice);
  return state.tracks.find((t) => t.id === inTurn) ?? state.tracks[0];
}

function advance() {
  if (state.choice !== ALL) return;
  inTurn = nextTrack(state.tracks, inTurn)?.id ?? null;
  sync();
}

function player(): HTMLAudioElement {
  if (el) return el;
  el = document.createElement("audio");
  el.className = "bgm";
  el.addEventListener("ended", advance);
  el.addEventListener("playing", () => (failures = 0));
  el.addEventListener("error", () => {
    if (++failures < state.tracks.length) advance();
  });
  document.body.appendChild(el);
  return el;
}

/** Make what's playing match the choice. */
function sync() {
  if (typeof document === "undefined") return;
  const track = wanted();
  if (!track) {
    if (el) {
      el.pause();
      el.removeAttribute("src");
      delete el.dataset.track;
    }
    return;
  }
  const a = player();
  if (state.choice === ALL) inTurn = track.id;
  const changed = a.getAttribute("src") !== track.url;
  if (changed) {
    a.src = track.url;
    a.dataset.track = track.id;
  }
  a.loop = state.choice !== ALL || state.tracks.length === 1;
  a.volume = state.volume;
  if (soundMuted()) a.pause();
  else if (changed || a.paused) void a.play()?.catch(() => {}); // refused until a first click
}

function update(next: Partial<MusicState>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify({ choice: state.choice, volume: state.volume }));
  } catch {
    // not remembered, fine
  }
  sync();
  listeners.forEach((l) => l());
}

export function setTrack(choice: string): void {
  failures = 0;
  update({ choice });
}

export function setMusicVolume(volume: number): void {
  update({ volume: Math.min(1, Math.max(0, volume)) });
}

/** Ask the server which tracks exist (at startup, and again whenever Settings opens). */
export async function loadMusic(): Promise<void> {
  try {
    const r = await fetch("/api/music");
    if (!r.ok) return;
    const tracks = (await r.json()) as Track[];
    if (Array.isArray(tracks)) update({ tracks });
  } catch {
    // no server (unit tests, offline): no music
  }
}

/** Call once at startup. */
export function initMusic(): void {
  onSoundChange(sync); // mute / unmute
  // browsers only allow sound after a click or key press: start (or retry) then
  const retry = () => {
    if (!el || el.paused) sync();
  };
  window.addEventListener("pointerdown", retry);
  window.addEventListener("keydown", retry);
  void loadMusic();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useMusic(): MusicState {
  return useSyncExternalStore(subscribe, () => state);
}
