import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { cardInfo, cardTitle, reasonTitle, sealChar, skillTitle } from "../content";
import { judgment, type JudgmentShow } from "../fx/judgment";
import { holdDeath, killBlow } from "../fx/killBlow";
import { fxSpeed, Stage } from "../fx/stage";
import { killStreak, streakAt } from "../fx/streak";
import { holdTariff, tariffStamp } from "../fx/tariff";
import { getLang, t, tMaybe } from "../i18n";
import { play, playAll, playStreak, type SoundName } from "../sound";
import type { Card as CardData, LogEntry } from "../types";
import { Card, CardBack } from "../ui/Card";
import s from "./Effects.module.css";

/*
 * Motion for what just happened at the table, drawn on a layer over it (never in the
 * layout, so nothing moves):
 *   - a played card flies from the player's seat to its spot on the battlefield,
 *   - an ink stroke runs from the player to each target,
 *   - damage / healing float up over the seat as numbers,
 *   - your turn opens with a brush banner,
 *   - a judgment flips its card over the judged seat and stamps Hit / Miss on it
 *     (fx/judgment.ts),
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
  | { id: number; kind: "skill"; at: Pt; char: string; title: string; delay: number; gear: boolean }
  | { id: number; kind: "banner"; text: string }
  // a card changing hands: face up if you may see it, else face down
  | { id: number; kind: "transfer"; card: CardData | null; from: Pt; to: Pt; delay: number }
  // the discard pile shuffled into a new deck (the deck ran out)
  | { id: number; kind: "shuffle"; from: Pt; at: Pt };

/** An effect before it has an id (Omit applied to each member of the union). */
type NewFx = Fx extends infer F ? (F extends Fx ? Omit<F, "id"> : never) : never;

/** Effect lengths (ms); the CSS animations use the same numbers. */
// (a shuffle's last card starts SHUFFLE_CARDS × 30 ms after the first)
const LIFE = { flight: 520, line: 1100, number: 1200, banner: 1500, skill: 1500, transfer: 760, shuffle: 1700 } as const;
// Draws after a reshuffle wait for it: the new deck is dealt from once it's shuffled.
const SHUFFLE_DEAL = 1250;
const SHUFFLE_CARDS = 7;
// Several cards changing hands at once leave one after another.
const TRANSFER_STAGGER = 110;
const MAX_TRANSFER = 5;
// Two skills of the same player in one moment take turns in the same spot (the next one
// lands as the last one fades), at most three in a row.
const SKILL_STAGGER = 950;
const MAX_CASTS = 3;
const MAX_LIVE = 40; // fast bot games: drop effects rather than pile them up (a deal to 8 is 32 cards)

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
    else if (e.type === "reshuffle") out.push("shuffle");
    else if (e.type === "draw" && e.seat === you) out.push("select"); // your cards coming in
    else if (e.type === "game_over" && Array.isArray(e.winners)) out.push((e.winners as number[]).includes(you) ? "victory" : "defeat");
  }
  return out;
}

/** Cards a player shows the whole table, held up in the middle for a moment. */
export interface Reveal {
  title: string;
  cards: CardData[];
  /** A word for you alone (e.g. "you have no ♥ card"), or null. */
  note: string | null;
}

/** How long a reveal stays up (ms; the CSS animation uses the same number). */
export const REVEAL_MS = 3000;

/** The reveal a log entry calls for, if any (exported for unit tests). */
export function revealOf(e: LogEntry, you: number, hand: CardData[], nameOf?: (seat: number) => string): Reveal | null {
  const who = nameOf ? nameOf(e.seat) : "";
  const reason = reasonTitle(String(e.reason ?? ""));
  if (e.type === "show" && e.card) {
    const suit = String(e.card.suit);
    // Fire Attack: you need a card of the shown suit to go on. Say so when you have none.
    const stuck = e.reason === "fire_attack" && e.source === you && !hand.some((c) => c.suit === suit);
    return {
      title: t("reveal.shows", { name: who, reason }),
      cards: [e.card],
      note: stuck ? t("reveal.noSuit", { suit: tMaybe(`opt.${suit}`) ?? suit }) : null,
    };
  }
  if (e.type === "show_hand" && Array.isArray(e.cards)) {
    return {
      title: t("reveal.hand", { name: who, reason }),
      cards: e.cards as CardData[],
      note: e.cards.length ? null : t("reveal.emptyHand"),
    };
  }
  return null;
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
  aimFrom = you,
  aim,
  playSize = "sm",
  nameOf,
  hand = [],
}: {
  log: LogEntry[];
  you: number;
  /** Where your aim lines start: your seat, or the bot you're playing for (test room). */
  aimFrom?: number;
  aim: number[];
  playSize?: "sm" | "md";
  /** A seat's display name (the kill streak banner names the killer). */
  nameOf?: (seat: number) => string;
  /** Your hand (a Fire Attack reveal tells you when you have no card of the shown suit). */
  hand?: CardData[];
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<(Reveal & { id: number }) | null>(null);
  const revealTimer = useRef<number | undefined>(undefined);
  const showReveal = (r: Reveal) => {
    const id = nextId.current++;
    setReveal({ ...r, id });
    window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => setReveal((cur) => (cur?.id === id ? null : cur)), REVEAL_MS * Math.max(1, 1 / fxSpeed()));
  };
  useEffect(() => () => window.clearTimeout(revealTimer.current), []);
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
    const from = centreIn(el, document.querySelector(`[data-seat="${aimFrom}"]`));
    const paths: string[] = [];
    for (const seat of aimKey ? aimKey.split(",").map(Number) : []) {
      const to = centreIn(el, document.querySelector(`[data-seat="${seat}"]`));
      if (from && to && seat !== aimFrom) paths.push(strokePath(from, to));
    }
    setAimPaths((old) => (old.join("|") === paths.join("|") ? old : paths));
  }, [aimKey, aimFrom, resizes]);

  useLayoutEffect(() => {
    const start = seen.current;
    seen.current = log.length;
    if (log.length <= start) return;
    const el = layer.current;
    const motion = !!el && !reducedMotion();
    const deaths: number[] = [];
    const judged: number[] = [];
    const tariffs: number[] = []; // a Tariff put on a player: the stamp falls on them
    for (let i = start; i < log.length; i++) {
      const e = log[i];
      if (e.type === "death") deaths.push(i);
      if (e.type === "judge_result") judged.push(i);
      if (e.type === "token" && e.token === "tariff" && e.delta > 0) tariffs.push(i);
    }
    // Sounds play even with reduced motion (that setting is about movement, not audio).
    // A killing blow sounds its own gong when it lands; a kill streak its own fanfare.
    playAll(soundsFor(log.slice(start), you).filter((n) => !(motion && deaths.length && n === "death")));
    // Cards shown to everyone (Fire Attack, What's up Beijing!) go up in the middle of the
    // table for a few seconds, motion or not: it's information, not decoration.
    for (let i = start; i < log.length; i++) {
      const r = revealOf(log[i], you, hand, nameOf);
      if (r) showReveal(r);
    }
    const judgeOf = (i: number): JudgmentShow => {
      const e = log[i];
      const reason = String(e.reason ?? "");
      return {
        seat: e.seat,
        hit: !!e.hit,
        word: t(e.hit ? "fx.judgeHit" : "fx.judgeMiss"),
        reason: reason ? reasonTitle(reason) : "",
        zh: getLang() === "zh",
        cardEl: document.querySelector(`[data-play-key="${i}"]`),
      };
    };
    if (!motion || !el) {
      for (const i of judged) play(log[i].hit ? "judgeHit" : "judgeMiss", 0.15);
      for (const i of deaths) if (streakAt(log, i) >= 2) playStreak(streakAt(log, i), 0.4);
      if (tariffs.length) play("tariff", 0.1);
      return;
    }
    // Big moments take the stage in the order they happened (a Lightning judgment, then
    // the death it caused).
    for (const i of [...judged, ...deaths, ...tariffs].sort((a, b) => a - b)) {
      const d = log[i];
      if (d.type === "token") {
        const release = holdTariff(d.seat); // before this paints: the chip appears on impact
        const show = { seat: d.seat, label: t("token.tariff"), release };
        stage.current!.add({ run: () => tariffStamp(el, show), skip: release });
        continue;
      }
      if (d.type === "judge_result") {
        // Copy the card now: the battlefield may have moved on by the time it plays.
        const show = judgeOf(i);
        const face = show.cardEl?.querySelector(".card") ?? null;
        const box = face?.getBoundingClientRect();
        const zoom = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
        show.cardEl = face ? (face.cloneNode(true) as Element) : null;
        show.cardSize = box?.width ? { w: box.width / zoom, h: box.height / zoom } : null;
        stage.current!.add({ run: () => judgment(el, show), skip: () => play(show.hit ? "judgeHit" : "judgeMiss") });
        continue;
      }
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
    // A skill (or a piece of gear) going off: its seal stamps onto the player's hero card.
    const castsAt = new Map<number, number>(); // seat -> skills already shown this moment
    const cast = (who: number, id: string) => {
      const at = centre(document.querySelector(`[data-seat="${who}"] .hero-face`)) ?? seat(who);
      if (!at) return;
      const n = castsAt.get(who) ?? 0;
      if (n >= MAX_CASTS) return;
      castsAt.set(who, n + 1);
      const gear = !!cardInfo(id);
      add({
        kind: "skill",
        at,
        char: sealChar(gear ? "card" : "skill", id, "last"),
        title: gear ? cardTitle(id) : skillTitle(id),
        delay: n * SKILL_STAGGER,
        gear,
      });
    };
    // Cards changing hands fly from one seat to the other (or from the middle of the table).
    const middle = () => centre(document.querySelector(".center .plays") ?? document.querySelector(".center"));
    // (each pile: its card or empty slot first, then its count)
    const deck = () => centre(document.querySelector('[data-pile="draw"] > :first-child'));
    const discards = () => centre(document.querySelector('[data-pile="discard"] > :first-child'));
    let wait = 0; // after a reshuffle in this batch, later cards wait for the new deck
    const transfer = (cards: (CardData | null)[], from: Pt | null, to: Pt | null) => {
      if (!from || !to) return;
      cards
        .slice(0, MAX_TRANSFER)
        .forEach((card, n) => add({ kind: "transfer", card, from, to, delay: wait + n * TRANSFER_STAGGER }));
    };
    for (let i = start; i < log.length; i++) {
      const e = log[i];
      if (e.type === "reshuffle") {
        const from = discards();
        const at = deck();
        if (from && at) {
          add({ kind: "shuffle", from, at });
          wait = SHUFFLE_DEAL;
        }
      }
      // Drawn cards leave the deck for the drawer: face up for your own (you see them), else face down.
      if (e.type === "draw" && typeof e.count === "number" && e.count > 0) {
        const cards: (CardData | null)[] = Array.isArray(e.cards) ? e.cards : Array.from({ length: e.count }, () => null);
        transfer(cards, deck(), seat(e.seat));
      }
      if (e.type === "take") {
        const cards: (CardData | null)[] = Array.isArray(e.cards) ? e.cards : [e.card ?? null];
        transfer(cards, e.target != null ? seat(e.target) : middle(), seat(e.seat));
      }
      if (e.type === "give") transfer([e.card ?? null], seat(e.seat), seat(e.target));
      if (e.type === "pick" && e.card) transfer([e.card], middle(), seat(e.seat)); // a Harvest pick
      if (e.type === "skill" && typeof e.skill === "string") cast(e.seat, e.skill);
      if ((e.type === "use" || e.type === "respond") && typeof e.via === "string") cast(e.seat, e.via);
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
    const longest = Math.max(...made.map((f) => LIFE[f.kind] + ("delay" in f ? f.delay : 0)));
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
        if (f.kind === "transfer") {
          const style = {
            left: f.to.x,
            top: f.to.y,
            "--dx": `${f.from.x - f.to.x}px`,
            "--dy": `${f.from.y - f.to.y}px`,
            "--delay": `${f.delay / fxSpeed()}ms`,
          } as CSSProperties;
          return (
            <span key={f.id} className={`${s.transfer} card-transfer`} style={style} data-face={f.card ? "up" : "down"}>
              {f.card ? <Card card={f.card} size="sm" tip={false} /> : <CardBack size="sm" />}
            </span>
          );
        }
        if (f.kind === "shuffle") {
          // the discards gather onto the deck, are riffled twice, and settle as the new deck
          return (
            <span key={f.id} className={`${s.shuffle} deck-shuffle`} style={{ left: f.at.x, top: f.at.y }}>
              {Array.from({ length: SHUFFLE_CARDS }, (_, i) => (
                <span
                  key={i}
                  className={s.shuffleCard}
                  style={
                    {
                      "--dx": `${f.from.x - f.at.x}px`,
                      "--dy": `${f.from.y - f.at.y}px`,
                      "--side": i % 2 ? 1 : -1,
                      "--i": i,
                    } as CSSProperties
                  }
                >
                  <CardBack size="sm" />
                </span>
              ))}
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
        if (f.kind === "skill") {
          const style = { left: f.at.x, top: f.at.y, "--delay": `${f.delay / fxSpeed()}ms` } as CSSProperties;
          return (
            <span key={f.id} className={`${s.cast} ${f.gear ? s.gear : ""} skill-cast`} style={style} data-title={f.title}>
              <span className={s.castSeal} lang="zh-CN">
                {f.char}
              </span>
              <span className={s.castName} lang={getLang() === "zh" ? "zh-CN" : undefined}>
                {f.title}
              </span>
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
      {reveal && (
        <div key={reveal.id} className={`${s.reveal} card-reveal`} style={{ "--reveal": `${REVEAL_MS}ms` } as CSSProperties}>
          <span className={`${s.revealTitle} reveal-title`}>{reveal.title}</span>
          {reveal.cards.length > 0 && (
            <span className={s.revealCards}>
              {reveal.cards.map((c) => (
                <Card key={c.id} card={c} size="md" tip={false} />
              ))}
            </span>
          )}
          {reveal.note && <span className={`${s.revealNote} reveal-note`}>{reveal.note}</span>}
        </div>
      )}
    </div>
  );
}
