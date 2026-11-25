import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { holdDeath, killBlow } from "../fx/killBlow";
import { fxSpeed, Stage } from "../fx/stage";
import { killStreak, streakAt } from "../fx/streak";
import { getLang, t } from "../i18n";
import { playAll, playStreak, type SoundName } from "../sound";
import type { LogEntry } from "../types";
import { Card } from "../ui/Card";
import s from "./Effects.module.css";

/*
 * Motion for what just happened at the table, drawn on a layer over it (never in the
 * layout, so nothing moves):
 *   - a played card flies from the player's seat to its spot on the battlefield,
 *   - an ink stroke runs from the player to each target,
 *   - damage / healing float up over the seat as numbers,
 *   - your turn opens with a brush banner,
 *   - a death plays the killing blow (fx/killBlow.ts), and from a player's second kill a
 *     kill streak banner (fx/streak.ts); these big moments queue on a Stage.
 * Only entries that arrive while you watch animate: a reconnect, a rejoin or the gallery
 * shows the table at rest. Positions come from the DOM ([data-seat], [data-play-key]),
 * so this works for every layout (seats in a row, stacked, phone).
 */

type Pt = { x: number; y: number };
type Fx =
  | { id: number; kind: "flight"; card: LogEntry["card"]; from: Pt; to: Pt }
  | { id: number; kind: "line"; from: Pt; to: Pt }
  | { id: number; kind: "number"; at: Pt; text: string; heal: boolean }
  | { id: number; kind: "banner"; text: string };

/** An effect before it has an id (Omit applied to each member of the union). */
type NewFx = Fx extends infer F ? (F extends Fx ? Omit<F, "id"> : never) : never;

/** Effect lengths (ms); the CSS animations use the same numbers. */
const LIFE = { flight: 520, line: 1100, number: 1200, banner: 1500 } as const;
const MAX_LIVE = 16; // fast bot games: drop effects rather than pile them up

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The sounds for a batch of new log entries (exported for unit tests). */
export function soundsFor(entries: LogEntry[], you: number): SoundName[] {
  const out: SoundName[] = [];
  for (const e of entries) {
    if (e.type === "use" || e.type === "respond") out.push("card");
    else if (e.type === "equip") out.push("equip");
    else if (e.type === "damage") out.push("damage");
    else if (e.type === "recover") out.push("heal");
    else if (e.type === "death") out.push("death");
    else if (e.type === "turn_start" && e.seat === you) out.push("turn");
    else if (e.type === "game_over" && Array.isArray(e.winners)) out.push((e.winners as number[]).includes(you) ? "victory" : "defeat");
  }
  return out;
}

/** Centre of an element, relative to the effects layer. */
function centreIn(layer: HTMLElement, el: Element | null): Pt | null {
  if (!el) return null;
  const base = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!r.width) return null;
  // Rects are in screen pixels; the layer's CSS pixels are zoomed by the interface size.
  const zoom = layer.offsetWidth ? base.width / layer.offsetWidth : 1;
  return { x: (r.left + r.width / 2 - base.left) / zoom, y: (r.top + r.height / 2 - base.top) / zoom };
}

/** Quadratic path with a slight bow, like a brush stroke rather than a ruler line. */
function strokePath(from: Pt, to: Pt): string {
  const mx = (from.x + to.x) / 2 - (to.y - from.y) * 0.12;
  const my = (from.y + to.y) / 2 + (to.x - from.x) * 0.12;
  return `M${from.x},${from.y} Q${mx},${my} ${to.x},${to.y}`;
}

/**
 * @param aim seats you have selected as targets right now: a dashed ink line runs from
 *            your plaque to each, until you play or cancel.
 */
export function Effects({
  log,
  you,
  aim,
  playSize = "sm",
  nameOf,
}: {
  log: LogEntry[];
  you: number;
  aim: number[];
  playSize?: "sm" | "md";
  /** A seat's display name (the kill streak banner names the killer). */
  nameOf?: (seat: number) => string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const seen = useRef(log.length); // entries already on the table when we mounted
  const nextId = useRef(1);
  const [fx, setFx] = useState<Fx[]>([]);
  const [aimPaths, setAimPaths] = useState<string[]>([]);
  const [resizes, setResizes] = useState(0);
  const stage = useRef<Stage | null>(null);
  stage.current ??= new Stage();
  const aimKey = aim.join(",");

  useEffect(() => () => stage.current?.clear(), []);

  useEffect(() => {
    const onResize = () => setResizes((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    const from = centreIn(el, document.querySelector(`[data-seat="${you}"]`));
    const paths: string[] = [];
    for (const seat of aimKey ? aimKey.split(",").map(Number) : []) {
      const to = centreIn(el, document.querySelector(`[data-seat="${seat}"]`));
      if (from && to && seat !== you) paths.push(strokePath(from, to));
    }
    setAimPaths((old) => (old.join("|") === paths.join("|") ? old : paths));
  }, [aimKey, you, resizes]);

  useLayoutEffect(() => {
    const start = seen.current;
    seen.current = log.length;
    if (log.length <= start) return;
    const el = layer.current;
    const motion = !!el && !reducedMotion();
    const deaths: number[] = [];
    for (let i = start; i < log.length; i++) if (log[i].type === "death") deaths.push(i);
    // Sounds play even with reduced motion (that setting is about movement, not audio).
    // A killing blow sounds its own gong when it lands; a kill streak its own fanfare.
    playAll(soundsFor(log.slice(start), you).filter((n) => !(motion && deaths.length && n === "death")));
    if (!motion || !el) {
      for (const i of deaths) if (streakAt(log, i) >= 2) playStreak(streakAt(log, i), 0.4);
      return;
    }
    for (const i of deaths) {
      const d = log[i];
      const release = holdDeath(d.seat); // before this paints: the victim falls on impact
      const killer = typeof d.killer === "number" ? d.killer : null;
      stage.current!.add({ run: () => killBlow(el, killer, d.seat, release), skip: release });
      const level = streakAt(log, i);
      if (level >= 2 && killer != null) {
        const who = nameOf ? nameOf(killer) : "";
        const run = () => killStreak(el, level, t(`streak.${level}` as "streak.2"), who, getLang() === "zh");
        stage.current!.add({ run, skip: () => playStreak(level) });
      }
    }
    const centre = (target: Element | null) => centreIn(el, target);
    const seat = (n: number | null | undefined) => (n == null ? null : centre(document.querySelector(`[data-seat="${n}"]`)));

    const made: Fx[] = [];
    const add = (f: NewFx) => made.push({ ...f, id: nextId.current++ } as Fx);
    for (let i = start; i < log.length; i++) {
      const e = log[i];
      if (e.type === "use" || e.type === "respond") {
        const from = seat(e.seat);
        const to = centre(document.querySelector(`[data-play-key="${i}"]`));
        if (from && to) add({ kind: "flight", card: e.card, from, to });
      }
      if ((e.type === "use" || e.type === "skill") && Array.isArray(e.targets)) {
        const from = seat(e.seat);
        for (const tg of e.targets as number[]) {
          const to = seat(tg);
          if (from && to && tg !== e.seat) add({ kind: "line", from, to });
        }
      }
      if (e.type === "damage" || e.type === "recover") {
        const at = seat(e.type === "damage" ? e.target : e.seat);
        const heal = e.type === "recover";
        if (at) add({ kind: "number", at, heal, text: `${heal ? "+" : "−"}${e.amount}` });
      }
      if (e.type === "turn_start" && e.seat === you) add({ kind: "banner", text: t("table.yourTurn") });
    }
    if (!made.length) return;
    setFx((live) => [...live, ...made].slice(-MAX_LIVE));
    const ids = new Set(made.map((f) => f.id));
    const longest = Math.max(...made.map((f) => LIFE[f.kind]));
    window.setTimeout(() => setFx((live) => live.filter((f) => !ids.has(f.id))), longest / fxSpeed() + 50);
  }, [log, you]);

  return (
    <div ref={layer} className={`${s.layer} fx-layer`} aria-hidden="true">
      {(aimPaths.length > 0 || fx.some((f) => f.kind === "line")) && (
        <svg className={s.lines}>
          {aimPaths.map((d) => (
            <path key={d} className={`${s.aim} aim-line`} d={d} />
          ))}
          {fx.map((f) => {
            if (f.kind !== "line") return null;
            const len = Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);
            return (
              <path
                key={f.id}
                className={s.line}
                d={strokePath(f.from, f.to)}
                style={{ "--len": `${Math.ceil(len * 1.1)}` } as CSSProperties}
              />
            );
          })}
        </svg>
      )}
      {fx.map((f) => {
        if (f.kind === "flight") {
          const style = {
            left: f.to.x,
            top: f.to.y,
            "--dx": `${f.from.x - f.to.x}px`,
            "--dy": `${f.from.y - f.to.y}px`,
          } as CSSProperties;
          return (
            <span key={f.id} className={s.flight} style={style}>
              <Card card={f.card} size={playSize} tip={false} />
            </span>
          );
        }
        if (f.kind === "number") {
          return (
            <span key={f.id} className={`${s.number} ${f.heal ? s.heal : ""}`} style={{ left: f.at.x, top: f.at.y }}>
              {f.text}
            </span>
          );
        }
        if (f.kind === "banner") {
          return (
            <span key={f.id} className={`${s.banner} turn-banner`}>
              <span className={s.bannerText} lang={getLang() === "zh" ? "zh-CN" : undefined}>
                {f.text}
              </span>
            </span>
          );
        }
        return null;
      })}
    </div>
  );
}
