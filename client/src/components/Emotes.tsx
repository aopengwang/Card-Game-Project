import { useEffect, useRef, useState } from "react";
import { getLang, t, useLang } from "../i18n";
import { sendEmote, type EmoteEvent } from "../net";
import { Button } from "../ui/Button";
import s from "./Emotes.module.css";

/** The emotes (ids match server/net/room.py EMOTES): a brush character on a seal, a colour. */
export const EMOTES: { id: string; char: string; tone: "gold" | "jade" | "ink" | "red" }[] = [
  { id: "nice", char: "好", tone: "gold" },
  { id: "haha", char: "哈", tone: "jade" },
  { id: "thanks", char: "谢", tone: "jade" },
  { id: "sorry", char: "歉", tone: "ink" },
  { id: "angry", char: "怒", tone: "red" },
  { id: "whoa", char: "惊", tone: "gold" },
  { id: "hmm", char: "思", tone: "ink" },
  { id: "cheers", char: "杯", tone: "red" },
  { id: "gg", char: "服", tone: "gold" },
  { id: "hurry", char: "快", tone: "red" },
];
const byId = new Map(EMOTES.map((e) => [e.id, e]));
const label = (id: string) => t(`emote.${id}` as "emote.nice");

/** An emote's seal with its label underneath. */
export function EmoteSeal({ id, small }: { id: string; small?: boolean }) {
  const e = byId.get(id);
  if (!e) return null;
  return (
    <span className={`${s.emote} ${s[e.tone]} ${small ? s.small : ""}`}>
      <span className={s.seal} lang="zh-CN" aria-hidden="true">
        {e.char}
      </span>
      <span className={s.label}>{label(id)}</span>
    </span>
  );
}

const COOLDOWN = 1200; // ms between your own emotes (the server allows 4 per 6 seconds)

/** Top-bar button: opens a picker; picking an emote sends it to the table. */
export function EmoteButton() {
  useLang();
  const [open, setOpen] = useState(false);
  const [cooling, setCooling] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    root.current?.querySelector<HTMLButtonElement>("[data-emote]")?.focus();
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (id: string) => {
    sendEmote(id);
    setOpen(false);
    setCooling(true);
    window.setTimeout(() => setCooling(false), COOLDOWN);
  };

  return (
    <div className={`${s.picker} emote-picker`} ref={root}>
      <Button
        shape="pill"
        className="emote-toggle"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t("emote.open")}
        title={t("emote.open")}
        disabled={cooling}
        onClick={() => setOpen(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <circle cx="10" cy="10" r="8" />
          <path d="M6.5 12c1 1.6 2.2 2.3 3.5 2.3s2.5-.7 3.5-2.3" strokeLinecap="round" />
          <circle cx="7.3" cy="8" r="1" fill="currentColor" stroke="none" />
          <circle cx="12.7" cy="8" r="1" fill="currentColor" stroke="none" />
        </svg>
      </Button>
      {open && (
        <div className={s.panel} role="menu" aria-label={t("emote.open")} lang={getLang() === "zh" ? "zh-CN" : undefined}>
          {EMOTES.map((e) => (
            <button key={e.id} type="button" role="menuitem" className={s.option} data-emote={e.id} onClick={() => pick(e.id)}>
              <EmoteSeal id={e.id} small />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The latest emote from each seat, for a moment (only ones that arrive while you watch). */
export function useEmotePops(emotes: EmoteEvent[], ms = 2600): Map<number, EmoteEvent> {
  const seenUpTo = useRef(emotes.length ? emotes[emotes.length - 1].key : 0);
  const [pops, setPops] = useState<Map<number, EmoteEvent>>(() => new Map());
  useEffect(() => {
    const fresh = emotes.filter((e) => e.key > seenUpTo.current);
    if (!fresh.length) return;
    seenUpTo.current = fresh[fresh.length - 1].key;
    setPops((prev) => new Map([...prev, ...fresh.map((e) => [e.seat, e] as const)]));
    const keys = new Set(fresh.map((e) => e.key));
    window.setTimeout(() => setPops((prev) => new Map([...prev].filter(([, e]) => !keys.has(e.key)))), ms);
  }, [emotes, ms]);
  return pops;
}

/**
 * An emote popping up beside a seat: off the card's top-right corner, or its top-left for a
 * seat at the table's right edge (it would be cut off), or just inside the card where the
 * seats are stacked (phones: it must not widen the page).
 */
export function EmotePop({ event, side = "right" }: { event: EmoteEvent; side?: "right" | "left" | "inside" }) {
  return (
    <span key={event.key} className={`${s.pop} ${s[side]} emote-pop`} data-emote={event.emote} data-side={side} role="status">
      <EmoteSeal id={event.emote} />
    </span>
  );
}
