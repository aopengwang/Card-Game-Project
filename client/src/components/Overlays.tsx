import { useEffect, useRef } from "react";
import { heroInfo, heroName, kingdomName, roleName, useContent } from "../content";
import { describe, type LogLine } from "../describe";
import { serverText, t, tMaybe, useLang } from "../i18n";
import { answer, send } from "../net";
import type { ChooseHeroReq, GameView, LogEntry, RoomInfo } from "../types";
import { Art } from "./Art";

export function HeroPick({ req, isLordPick }: { req: ChooseHeroReq; isLordPick: boolean }) {
  useContent();
  return (
    <div className="overlay">
      <div className="modal hero-pick" role="dialog" aria-label={t("hero.choose")}>
        <h2>{t("hero.choose")}</h2>
        <p className="muted">{isLordPick ? t("hero.lordNote") : t("hero.otherNote")}</p>
        {req.error && <div className="error-line">{serverText(req.error)}</div>}
        <div className="hero-grid">
          {req.options.map((id) => {
            const h = heroInfo(id);
            if (!h) return null;
            return (
              <button key={id} type="button" className={`hero-card kingdom-${h.kingdom}`} onClick={() => answer(id)}>
                <div className="hero-head">
                  <Art kind="heroes" id={id} className="portrait lg" fallback={<span className="portrait-initial">{h.name[0]}</span>} />
                  <div>
                    <div className="hero-name">{h.name}</div>
                    <div className="muted small">
                      {t("hero.stats", {
                        kingdom: kingdomName(h.kingdom),
                        hp: h.max_hp,
                        gender: tMaybe(`gender.${h.gender}`) ?? h.gender,
                      })}
                    </div>
                  </div>
                </div>
                {h.skills.map((s) => (
                  <div key={s.id} className="hero-skill">
                    <b>{s.title ?? s.id}</b>
                    {s.tags.map((tag) => (
                      <span key={tag} className="badge">
                        {tMaybe(`tag.${tag}`) ?? tag}
                      </span>
                    ))}
                    <div className="small">{s.text}</div>
                  </div>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function GameOver({ view, room, name, onClose }: { view: GameView; room: RoomInfo; name: (s: number) => string; onClose: () => void }) {
  useContent();
  const result = view.result!;
  const isHost = room.you === room.host;
  const won = result.winners.includes(view.you);
  return (
    <div className="overlay">
      <div className="modal game-over" role="dialog" aria-label={won ? t("over.victory") : t("over.defeat")}>
        <h2>{won ? t("over.victory") : t("over.defeat")}</h2>
        <p>{t("over.wins", { side: tMaybe(`side.${result.side}`) ?? result.side })}</p>
        <table className="results">
          <tbody>
            {view.players.map((p) => (
              <tr key={p.seat} className={result.winners.includes(p.seat) ? "winner" : ""}>
                <td>{name(p.seat)}</td>
                <td>{heroName(p.hero)}</td>
                <td>{p.role ? roleName(p.role) : "?"}</td>
                <td>{p.alive ? t("over.alive") : t("over.fallen")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          {isHost ? (
            <button className="primary" onClick={() => send({ type: "start" })}>
              {t("lobby.rematch")}
            </button>
          ) : (
            <span className="muted">{t("over.waitRematch")}</span>
          )}
          <button onClick={onClose}>{t("over.look")}</button>
        </div>
      </div>
    </div>
  );
}

export function LogPanel({ log, name }: { log: LogEntry[]; name: (s: number | null | undefined) => string }) {
  useContent();
  useLang();
  const ref = useRef<HTMLDivElement>(null);
  const lines: (LogLine & { key: number })[] = [];
  log.forEach((e, i) => {
    const l = describe(e, name);
    if (l) lines.push({ ...l, key: i });
  });
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div className="log" ref={ref} aria-live="polite">
      {lines.map((l) => (
        <div key={l.key} className={`log-line tone-${l.tone}`}>
          {l.text}
        </div>
      ))}
    </div>
  );
}
