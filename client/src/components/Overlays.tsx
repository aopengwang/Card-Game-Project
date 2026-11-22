import { useEffect, useRef } from "react";
import { KINGDOM_NAME, heroInfo, titleCase, useContent } from "../content";
import { describe, type LogLine } from "../describe";
import { answer, send } from "../net";
import type { ChooseHeroReq, GameView, LogEntry, RoomInfo } from "../types";
import { Art } from "./Art";

export function HeroPick({ req, isLordPick }: { req: ChooseHeroReq; isLordPick: boolean }) {
  useContent();
  return (
    <div className="overlay">
      <div className="modal hero-pick" role="dialog" aria-label="Choose your hero">
        <h2>Choose your hero</h2>
        <p className="muted">{isLordPick ? "You are the Lord: everyone will see your pick." : "Your pick stays hidden until everyone has chosen."}</p>
        {req.error && <div className="error-line">{req.error}</div>}
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
                      {KINGDOM_NAME[h.kingdom]} · {h.max_hp} HP · {h.gender}
                    </div>
                  </div>
                </div>
                {h.skills.map((s) => (
                  <div key={s.id} className="hero-skill">
                    <b>{s.title ?? titleCase(s.id)}</b>
                    {s.tags.map((t) => (
                      <span key={t} className="badge">
                        {t}
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
  const result = view.result!;
  const isHost = room.you === room.host;
  const won = result.winners.includes(view.you);
  return (
    <div className="overlay">
      <div className="modal game-over" role="dialog" aria-label="Game over">
        <h2>{won ? "Victory!" : "Defeat"}</h2>
        <p>
          The <b>{titleCase(result.side)}</b> side wins.
        </p>
        <table className="results">
          <tbody>
            {view.players.map((p) => (
              <tr key={p.seat} className={result.winners.includes(p.seat) ? "winner" : ""}>
                <td>{name(p.seat)}</td>
                <td>{heroInfo(p.hero)?.name ?? p.hero}</td>
                <td>{p.role ? titleCase(p.role) : "?"}</td>
                <td>{p.alive ? "alive" : "fallen"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          {isHost ? (
            <button className="primary" onClick={() => send({ type: "start" })}>
              Rematch
            </button>
          ) : (
            <span className="muted">Waiting for the host to start a rematch…</span>
          )}
          <button onClick={onClose}>Look at the table</button>
        </div>
      </div>
    </div>
  );
}

export function LogPanel({ log, name }: { log: LogEntry[]; name: (s: number | null | undefined) => string }) {
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
