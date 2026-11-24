import { useState } from "react";
import { roleName, rolesFor, useContent } from "../content";
import { getLang, memberName, t, tMaybe, useLang } from "../i18n";
import { createRoom, joinRoom, leave, send, type NetState } from "../net";
import type { Card as CardData } from "../types";
import { RoleSeal } from "../ui/Bits";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { LangToggle } from "./LangToggle";
import s from "./Screens.module.css";

const NAME_KEY = "cardgame_name";
const ROLES = ["lord", "loyalist", "rebel", "spy"] as const;

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

const levelName = (level: string) => tMaybe(`level.${level}`) ?? level;

/** The title: brush characters in Chinese, the display face in English. */
function Brand() {
  const zh = getLang() === "zh";
  return (
    <h1 className={s.brand} lang={zh ? "zh-CN" : undefined}>
      <span className={s.brandSeal} lang="zh-CN" aria-hidden="true">
        三国
      </span>
      {t("app.title")}
    </h1>
  );
}

// A few real cards fanned out as decoration on the home page.
const FAN: CardData[] = [
  { id: -1, name: "strike", suit: "spade", rank: 7 },
  { id: -2, name: "peach", suit: "heart", rank: 3 },
  { id: -3, name: "nullify", suit: "club", rank: 12 },
];

export function Home({ error, initialCode }: { error: string | null; initialCode: string }) {
  useLang();
  useContent();
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
  const canJoin = !busy && !!name.trim() && code.trim().length === 5;
  return (
    <div className={s.screen}>
      <div className={s.corner}>
        <LangToggle />
      </div>
      <div className={s.homeGrid}>
        <header className={s.head}>
          <Brand />
          <p className={s.tagline}>{t("home.tagline")}</p>
        </header>
        <section className={s.intro}>
          <div className={s.fan} aria-hidden="true">
            {FAN.map((c, i) => (
              <span key={c.id} className={s.fanCard} style={{ transform: `rotate(${(i - 1) * 9}deg) translateY(${i === 1 ? -10 : 0}px)` }}>
                <Card card={c} size="lg" tip={false} />
              </span>
            ))}
          </div>
          <h2 className={s.subhead}>{t("home.rolesTitle")}</h2>
          <ul className={s.roles}>
            {ROLES.map((r) => (
              <li key={r} className={s.roleRow}>
                <RoleSeal role={r} />
                <span>
                  <b className={s.roleName}>{roleName(r)}</b> {t(`goal.${r}`)}
                </span>
              </li>
            ))}
          </ul>
          <p className={s.note}>{t("home.hidden")}</p>
        </section>

        <section className={`${s.panel} ${s.form}`}>
          <label className={s.field}>
            {t("home.name")}
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder={t("home.namePlaceholder")} autoFocus />
          </label>
          <Button variant="primary" className={s.wide} disabled={busy || !name.trim()} onClick={() => run(() => createRoom(name))}>
            {t("home.create")}
          </Button>
          <div className={s.divider}>
            <span>{t("home.or")}</span>
          </div>
          <form
            className={s.joinRow}
            onSubmit={(e) => {
              e.preventDefault();
              if (canJoin) void run(() => joinRoom(code, name));
            }}
          >
            <input
              value={code}
              maxLength={5}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t("home.codePlaceholder")}
              aria-label={t("home.codeLabel")}
              className={`${s.codeInput} code-input`}
            />
            <Button type="submit" disabled={!canJoin}>
              {t("home.join")}
            </Button>
          </form>
          {error && <div className="error-line">{error}</div>}
        </section>
      </div>
    </div>
  );
}

export function Lobby({ net }: { net: NetState }) {
  useLang();
  useContent();
  const room = net.room!;
  const [copied, setCopied] = useState(false);
  const levels = room.bot_levels ?? ["easy", "hard"];
  const [level, setLevel] = useState(levels.includes("hard") ? "hard" : levels[0]);
  const isHost = room.you === room.host;
  const n = room.members.length;
  const link = `${location.origin}/?room=${room.code}`;
  const help = tMaybe(`levelHelp.${level}`);
  const roles = rolesFor(n);
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
    <div className={s.screen}>
      <div className={s.corner}>
        {net.conn !== "open" && <span className="pill warn">{t("conn.reconnecting")}</span>}
        <LangToggle />
      </div>
      <div className={s.lobbyGrid}>
        <section className={`${s.panel} lobby`}>
          <h1 className={`${s.roomTitle} room-title`}>{t("lobby.room", { code: room.code })}</h1>
          <div className={s.invite}>
            <div className={`${s.codeSeal} room-code`} aria-hidden="true">
              {room.code.split("").map((ch, i) => (
                <span key={i}>{ch}</span>
              ))}
            </div>
            <div className={s.inviteText}>
              <b>{t("lobby.invite")}</b>
              <span className={s.note}>{t("lobby.inviteHint")}</span>
              <span className={s.linkRow}>
                <code className="invite-link">{link}</code>
                <Button shape="small" onClick={copy}>
                  {copied ? t("lobby.copied") : t("lobby.copy")}
                </Button>
              </span>
            </div>
          </div>

          <h2 className={s.subhead}>
            {t("lobby.seats")} <span className={s.count}>{t("lobby.players", { n, max: room.max_players })}</span>
          </h2>
          <div className={s.seats}>
            <ol className={`${s.members} members`}>
              {room.members.map((m, i) => (
                <li key={i} className={`${s.member} member ${m.connected ? "" : `${s.offline} offline`}`}>
                  <span className={s.seatNo}>{i + 1}</span>
                  <span className={s.memberBody}>
                    <span className={`${s.memberName} member-name`}>{memberName(m, i)}</span>
                    <span className={s.badges}>
                      {m.bot && (
                        <span className={`badge level-${m.level ?? "easy"}`}>
                          {m.level ? t("badge.levelBot", { level: levelName(m.level) }) : t("badge.bot")}
                        </span>
                      )}
                      {i === room.host && <span className="badge">{t("badge.host")}</span>}
                      {i === room.you && <span className="badge">{t("badge.you")}</span>}
                      {!m.connected && <span className="badge warn">{t("badge.offline")}</span>}
                    </span>
                  </span>
                  {isHost && i !== room.host && (
                    <Button shape="small" variant="ghost" className="member-remove" onClick={() => send({ type: "remove", seat: i })}>
                      {t("lobby.remove")}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
            {Array.from({ length: Math.max(0, room.max_players - n) }, (_, i) => (
              <div key={`open${i}`} className={s.open}>
                <span className={s.seatNo}>{n + i + 1}</span>
                {t("lobby.openSeat")}
              </div>
            ))}
          </div>
        </section>

        <aside className={`${s.panel} ${s.side}`}>
          <div>
            <h2 className={s.subhead}>{roles.length ? t("lobby.rolesFor", { n }) : t("lobby.rolesNeed", { min: room.min_players, max: room.max_players })}</h2>
            <div className={s.rolePreview}>
              {roles.map((r, i) => (
                <span key={i} className={s.rolePill}>
                  <RoleSeal role={r} />
                </span>
              ))}
            </div>
          </div>

          {isHost ? (
            <>
              <div>
                <h2 className={s.subhead}>{t("lobby.botLevel")}</h2>
                <div className={s.segmented} role="radiogroup" aria-label={t("lobby.botLevel")}>
                  {levels.map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={level === l} className={level === l ? s.segOn : ""} onClick={() => setLevel(l)}>
                      {levelName(l)}
                    </button>
                  ))}
                </div>
                {help && <p className={s.note}>{help}</p>}
              </div>
              <Button className={s.wide} disabled={n >= room.max_players} onClick={() => send({ type: "add_bot", level })}>
                {t("lobby.addBot")}
              </Button>
              <Button variant="primary" className={`${s.wide} ${s.start}`} disabled={n < room.min_players} onClick={() => send({ type: "start" })}>
                {room.status === "finished" ? t("lobby.rematch") : t("lobby.start")}
              </Button>
              {n < room.min_players && <p className={s.note}>{t("lobby.needMore", { min: room.min_players }).trim()}</p>}
            </>
          ) : (
            <p className={s.waiting}>{t("lobby.waitHost")}</p>
          )}
          <Button variant="ghost" shape="small" className={`${s.leave} leave-room`} onClick={() => leave()}>
            {t("lobby.leave")}
          </Button>
        </aside>
      </div>
    </div>
  );
}
