import { useSyncExternalStore } from "react";
import { serverText, t } from "./i18n";
import { play } from "./sound";
import type { ActiveRequest, GameView, LogEntry, RoomInfo, Waiting } from "./types";

export interface Session {
  code: string;
  token: string;
}

export interface Toast {
  id: number;
  text: string;
}

export interface ChatMessage {
  id: number;
  seat: number;
  name: string;
  text: string;
  time: number; // ms since epoch
  /** Arrived while connected (not part of the history sent on connecting). */
  live?: boolean;
}

/** An emote someone just sent (`key` is local and only increases). */
export interface EmoteEvent {
  key: number;
  seat: number;
  emote: string;
}

export interface NetState {
  session: Session | null;
  conn: "idle" | "connecting" | "open" | "reconnecting";
  room: RoomInfo | null;
  view: GameView | null;
  waiting: Waiting | null;
  request: ActiveRequest | null;
  log: LogEntry[];
  chat: ChatMessage[];
  emotes: EmoteEvent[];
  toasts: Toast[];
  homeError: string | null;
  /** The room you tried to join wants a password (show the field). */
  homeNeedsPassword: boolean;
}

const CHAT_KEEP = 100;
const PASSWORD_ERRORS = ["this room needs a password", "wrong password"];

const SESSION_KEY = "cardgame_session";

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: session just won't survive a refresh */
  }
}

let state: NetState = {
  session: null,
  conn: "idle",
  room: null,
  view: null,
  waiting: null,
  request: null,
  log: [],
  chat: [],
  emotes: [],
  toasts: [],
  homeError: null,
  homeNeedsPassword: false,
};
let emoteSeq = 0;
const listeners = new Set<() => void>();
let ws: WebSocket | null = null;
let retryMs = 500;
let toastSeq = 0;

function set(patch: Partial<NetState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const getState = (): NetState => state;

export function useNet(): NetState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function toast(text: string): void {
  const t = { id: ++toastSeq, text };
  set({ toasts: [...state.toasts, t] });
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), 4000);
}

// ---------------------------------------------------------------- lobby HTTP

/** A failed request: `message` for people, `detail` the server's own words. */
class RequestError extends Error {
  constructor(message: string, readonly detail: string) {
    super(message);
  }
}

async function post(path: string, body: unknown): Promise<Session> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "";
    throw new RequestError(detail ? serverText(detail) : t("err.requestFailed", { status: r.status }), detail);
  }
  return { code: data.code, token: data.token };
}

const codeOf = (code: string) => encodeURIComponent(code.trim().toUpperCase());

export async function createRoom(name: string): Promise<void> {
  try {
    start(await post("/api/rooms", { name }));
  } catch (e) {
    set({ homeError: (e as Error).message });
  }
}

export async function joinRoom(code: string, name: string, password = ""): Promise<void> {
  try {
    start(await post(`/api/rooms/${codeOf(code)}/join`, { name, password: password || null }));
  } catch (e) {
    const detail = e instanceof RequestError ? e.detail : "";
    set({ homeError: (e as Error).message, homeNeedsPassword: state.homeNeedsPassword || PASSWORD_ERRORS.includes(detail) });
  }
}

/** Does this room want a password to join? (null: no such room / can't tell) */
export async function roomLocked(code: string): Promise<boolean | null> {
  try {
    const r = await fetch(`/api/rooms/${codeOf(code)}`);
    if (!r.ok) return null;
    return !!(await r.json()).locked;
  } catch {
    return null;
  }
}

export function sendEmote(emote: string): void {
  send({ type: "emote", emote });
}

export function sendChat(text: string): void {
  const clean = text.trim();
  if (clean) send({ type: "chat", text: clean });
}

// ---------------------------------------------------------------- websocket

function start(session: Session): void {
  if (ws) {
    ws.onclose = null; // replacing the connection (also covers React StrictMode's double effects)
    ws.close();
    ws = null;
  }
  writeSession(session);
  set({ session, homeError: null, homeNeedsPassword: false, room: null, view: null, request: null, log: [], chat: [] });
  connect();
}

export function resume(roomFromUrl: string | null): void {
  const s = readSession();
  if (s && (!roomFromUrl || roomFromUrl.toUpperCase() === s.code)) start(s);
}

export function leave(message: string | null = null): void {
  writeSession(null);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  set({ session: null, conn: "idle", room: null, view: null, request: null, waiting: null, log: [], chat: [], homeError: message });
}

function connect(): void {
  const s = state.session;
  if (!s) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const sock = new WebSocket(`${proto}://${location.host}/ws/${s.code}?token=${encodeURIComponent(s.token)}`);
  ws = sock;
  set({ conn: state.conn === "idle" ? "connecting" : "reconnecting" });
  sock.onopen = () => {
    retryMs = 500;
    set({ conn: "open" });
  };
  sock.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  sock.onclose = () => {
    if (ws !== sock || !state.session) return;
    set({ conn: "reconnecting", request: null });
    setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 8000);
  };
}

export function send(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function answer(value: unknown): void {
  const r = state.request;
  if (!r) return;
  send({ type: "answer", id: r.id, answer: value });
  set({ request: null });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function onMessage(m: any): void {
  switch (m.type) {
    case "room":
      set({ room: m, ...(m.status === "lobby" ? { view: null, log: [] } : {}) });
      break;
    case "state":
      set({ view: m.view, waiting: m.waiting });
      break;
    case "log":
      set({ log: m.start === 0 ? m.entries : [...state.log, ...m.entries] });
      break;
    case "request": {
      const total = m.timeout * 1000;
      set({ request: { id: m.id, req: m.request, deadline: Date.now() + total, total, asView: m.as_view ?? undefined } });
      break;
    }
    case "timeout":
      if (state.request?.id === m.id) {
        set({ request: null });
        toast(t("toast.timeout"));
      }
      break;
    case "error":
      if (m.fatal) leave(serverText(m.message));
      else toast(serverText(m.message));
      break;
    case "kicked":
      leave(t("toast.kicked"));
      break;
    case "chat_history":
      set({ chat: (m.messages as ChatMessage[]).slice(-CHAT_KEEP) });
      break;
    case "chat": {
      const { type: _type, ...msg } = m;
      set({ chat: [...state.chat, { ...(msg as ChatMessage), live: true }].slice(-CHAT_KEEP) });
      break;
    }
    case "emote":
      set({ emotes: [...state.emotes, { key: ++emoteSeq, seat: m.seat, emote: m.emote }].slice(-20) });
      play("emote");
      break;
  }
}

/** Test hook: reset module state. */
export function _reset(patch: Partial<NetState> = {}): void {
  state = { ...state, room: null, view: null, request: null, log: [], chat: [], emotes: [], toasts: [], ...patch };
}
