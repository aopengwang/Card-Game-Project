import { useState } from "react";
import { createRoom, joinRoom, leave, send, type NetState } from "../net";

const NAME_KEY = "cardgame_name";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Home({ error, initialCode }: { error: string | null; initialCode: string }) {
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const remember = () => {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
  };
  const run = async (fn: () => Promise<void>) => {
    remember();
    setBusy(true);
    await fn();
    setBusy(false);
  };
  return (
    <div className="home">
      <div className="home-card">
        <h1>Three Kingdoms Table</h1>
        <p className="muted">A hidden-role card game for 4–8 players. Lord, Loyalists, Rebels and a Spy.</p>
        <label>
          Your name
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jason" autoFocus />
        </label>
        <div className="home-actions">
          <button className="primary" disabled={busy || !name.trim()} onClick={() => run(() => createRoom(name))}>
            Create a room
          </button>
          <div className="join-row">
            <input
              value={code}
              maxLength={5}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              aria-label="Room code"
              className="code-input"
            />
            <button disabled={busy || !name.trim() || code.trim().length !== 5} onClick={() => run(() => joinRoom(code, name))}>
              Join
            </button>
          </div>
        </div>
        {error && <div className="error-line">{error}</div>}
      </div>
    </div>
  );
}

const LEVEL_HELP: Record<string, string> = {
  easy: "Easy: plays legal moves, barely reads the table.",
  hard: "Hard: tracks who attacks and saves whom, plays its role, values its cards.",
};

export function Lobby({ net }: { net: NetState }) {
  const room = net.room!;
  const [copied, setCopied] = useState(false);
  const levels = room.bot_levels ?? ["easy", "hard"];
  const [level, setLevel] = useState(levels.includes("hard") ? "hard" : levels[0]);
  const isHost = room.you === room.host;
  const n = room.members.length;
  const link = `${location.origin}/?room=${room.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the link is visible to copy by hand */
    }
  };
  return (
    <div className="home">
      <div className="home-card lobby">
        <div className="lobby-head">
          <h1>Room {room.code}</h1>
          {net.conn !== "open" && <span className="pill warn">reconnecting…</span>}
        </div>
        <div className="invite">
          <code>{link}</code>
          <button onClick={copy}>{copied ? "Copied!" : "Copy invite link"}</button>
        </div>
        <ol className="members">
          {room.members.map((m, i) => (
            <li key={i} className={m.connected ? "" : "offline"}>
              <span className="member-name">{m.name}</span>
              {m.bot && <span className={`badge level-${m.level ?? "easy"}`}>{m.level ? `${m.level} bot` : "bot"}</span>}
              {i === room.host && <span className="badge">host</span>}
              {i === room.you && <span className="badge">you</span>}
              {!m.connected && <span className="badge warn">offline</span>}
              {isHost && i !== room.host && (
                <button className="small-btn" onClick={() => send({ type: "remove", seat: i })}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
        {isHost ? (
          <>
          <div className="row">
            <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Bot difficulty" title={LEVEL_HELP[level]}>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l[0].toUpperCase() + l.slice(1)} bot
                </option>
              ))}
            </select>
            <button disabled={n >= room.max_players} onClick={() => send({ type: "add_bot", level })}>
              Add bot
            </button>
            <button className="primary" disabled={n < room.min_players} onClick={() => send({ type: "start" })}>
              {room.status === "finished" ? "Rematch" : "Start game"}
            </button>
            <span className="muted small">
              {n}/{room.max_players} players{n < room.min_players ? ` (need at least ${room.min_players})` : ""}
            </span>
          </div>
          {LEVEL_HELP[level] && <p className="muted small level-help">{LEVEL_HELP[level]}</p>}
          </>
        ) : (
          <p className="muted">Waiting for the host to start the game…</p>
        )}
        <button className="link-btn" onClick={() => leave()}>
          Leave room
        </button>
      </div>
    </div>
  );
}
