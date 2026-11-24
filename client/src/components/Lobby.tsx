import { useState } from "react";
import { memberName, t, tMaybe, useLang } from "../i18n";
import { createRoom, joinRoom, leave, send, type NetState } from "../net";
import { Button } from "../ui/Button";
import { LangToggle } from "./LangToggle";

const NAME_KEY = "cardgame_name";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

const levelName = (level: string) => tMaybe(`level.${level}`) ?? level;

export function Home({ error, initialCode }: { error: string | null; initialCode: string }) {
  useLang();
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
        <div className="card-head">
          <h1>{t("app.title")}</h1>
          <LangToggle />
        </div>
        <p className="muted">{t("home.tagline")}</p>
        <label>
          {t("home.name")}
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder={t("home.namePlaceholder")} autoFocus />
        </label>
        <div className="home-actions">
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => run(() => createRoom(name))}>
            {t("home.create")}
          </Button>
          <div className="join-row">
            <input
              value={code}
              maxLength={5}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t("home.codePlaceholder")}
              aria-label={t("home.codeLabel")}
              className="code-input"
            />
            <Button disabled={busy || !name.trim() || code.trim().length !== 5} onClick={() => run(() => joinRoom(code, name))}>
              {t("home.join")}
            </Button>
          </div>
        </div>
        {error && <div className="error-line">{error}</div>}
      </div>
    </div>
  );
}

export function Lobby({ net }: { net: NetState }) {
  useLang();
  const room = net.room!;
  const [copied, setCopied] = useState(false);
  const levels = room.bot_levels ?? ["easy", "hard"];
  const [level, setLevel] = useState(levels.includes("hard") ? "hard" : levels[0]);
  const isHost = room.you === room.host;
  const n = room.members.length;
  const link = `${location.origin}/?room=${room.code}`;
  const help = tMaybe(`levelHelp.${level}`);
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
        <div className="card-head">
          <h1>{t("lobby.room", { code: room.code })}</h1>
          {net.conn !== "open" && <span className="pill warn">{t("conn.reconnecting")}</span>}
          <LangToggle />
        </div>
        <div className="invite">
          <code>{link}</code>
          <Button shape="small" onClick={copy}>
            {copied ? t("lobby.copied") : t("lobby.copy")}
          </Button>
        </div>
        <ol className="members">
          {room.members.map((m, i) => (
            <li key={i} className={m.connected ? "" : "offline"}>
              <span className="member-name">{memberName(m, i)}</span>
              {m.bot && (
                <span className={`badge level-${m.level ?? "easy"}`}>
                  {m.level ? t("badge.levelBot", { level: levelName(m.level) }) : t("badge.bot")}
                </span>
              )}
              {i === room.host && <span className="badge">{t("badge.host")}</span>}
              {i === room.you && <span className="badge">{t("badge.you")}</span>}
              {!m.connected && <span className="badge warn">{t("badge.offline")}</span>}
              {isHost && i !== room.host && (
                <Button shape="small" variant="ghost" className="member-remove" onClick={() => send({ type: "remove", seat: i })}>
                  {t("lobby.remove")}
                </Button>
              )}
            </li>
          ))}
        </ol>
        {isHost ? (
          <>
            <div className="row">
              <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label={t("lobby.botLevel")} title={help ?? undefined}>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {t("lobby.botOption", { level: levelName(l) })}
                  </option>
                ))}
              </select>
              <Button disabled={n >= room.max_players} onClick={() => send({ type: "add_bot", level })}>
                {t("lobby.addBot")}
              </Button>
              <Button variant="primary" disabled={n < room.min_players} onClick={() => send({ type: "start" })}>
                {room.status === "finished" ? t("lobby.rematch") : t("lobby.start")}
              </Button>
              <span className="muted small">
                {t("lobby.players", { n, max: room.max_players })}
                {n < room.min_players ? t("lobby.needMore", { min: room.min_players }) : ""}
              </span>
            </div>
            {help && <p className="muted small level-help">{help}</p>}
          </>
        ) : (
          <p className="muted">{t("lobby.waitHost")}</p>
        )}
        <Button variant="ghost" shape="small" className="leave-room" onClick={() => leave()}>
          {t("lobby.leave")}
        </Button>
      </div>
    </div>
  );
}
