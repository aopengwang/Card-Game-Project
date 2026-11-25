import { useEffect, useRef, useState, type Ref } from "react";
import { t, useLang } from "../i18n";
import { sendChat, type ChatMessage } from "../net";
import { Button } from "../ui/Button";
import s from "./Chat.module.css";

const MAX = 200;

/** Messages, newest at the bottom, and a box to type in. Text is shown as typed (never as HTML). */
export function ChatBox({
  messages,
  you,
  inputRef,
  className,
}: {
  messages: ChatMessage[];
  you: number | null;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  useLang();
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = () => {
    if (!text.trim()) return;
    sendChat(text);
    setText("");
  };

  return (
    <div className={`${s.chat} ${className ?? ""} chat-box`}>
      <ol className={s.list} ref={list} aria-live="polite" aria-label={t("chat.title")}>
        {messages.length === 0 && <li className={s.empty}>{t("chat.empty")}</li>}
        {messages.map((m) => (
          <li key={m.id} className={`${s.msg} ${m.seat === you ? s.mine : ""} chat-msg`}>
            <b className={s.name}>{m.name}</b>
            <span className={s.text}>{m.text}</span>
          </li>
        ))}
      </ol>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          className={`${s.input} chat-input`}
          value={text}
          maxLength={MAX}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.label")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLInputElement).blur(); // back to the game
          }}
        />
        <Button type="submit" shape="small" disabled={!text.trim()}>
          {t("chat.send")}
        </Button>
      </form>
    </div>
  );
}

/**
 * The latest thing each seat said, for a few seconds (speech bubbles over the table).
 * Only messages that arrive while you watch, never the history sent on (re)connecting.
 */
export function useBubbles(messages: ChatMessage[], ms = 6000): Map<number, ChatMessage> {
  const seenUpTo = useRef(messages.length ? messages[messages.length - 1].id : 0);
  const [bubbles, setBubbles] = useState<Map<number, ChatMessage>>(() => new Map());
  useEffect(() => {
    const fresh = messages.filter((m) => m.live && m.id > seenUpTo.current);
    if (!fresh.length) return;
    seenUpTo.current = fresh[fresh.length - 1].id;
    setBubbles((prev) => new Map([...prev, ...fresh.map((m) => [m.seat, m] as const)]));
    const ids = new Set(fresh.map((m) => m.id));
    window.setTimeout(
      () => setBubbles((prev) => new Map([...prev].filter(([, m]) => !ids.has(m.id)))),
      ms,
    );
  }, [messages, ms]);
  return bubbles;
}
