import { useEffect, useRef } from "react";
import { heroInfo, heroName, kingdomName, useContent } from "../content";
import { describe, type LogLine } from "../describe";
import { serverText, t, tMaybe, useLang } from "../i18n";
import { answer, send } from "../net";
import type { ChooseHeroReq, GameView, LogEntry, RoomInfo } from "../types";
import { Beads, Portrait, RoleSeal } from "../ui/Bits";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import s from "./Overlays.module.css";

export function HeroPick({ req, isLordPick }: { req: ChooseHeroReq; isLordPick: boolean }) {
  useContent();
  return (
    <Modal open wide dismissible={false} title={t("hero.choose")} description={isLordPick ? t("hero.lordNote") : t("hero.otherNote")}>
      {req.error && <div className={s.error}>{serverText(req.error)}</div>}
      <div className={s.heroGrid}>
        {req.options.map((id) => {
          const h = heroInfo(id);
          if (!h) return null;
          return (
            <button key={id} type="button" className={`${s.heroCard} ${s[h.kingdom] ?? ""} hero-card`} onClick={() => answer(id)}>
              <Portrait hero={id} width="100%" height={110} />
              <span className={s.heroBody}>
                <span className={s.heroHead}>
                  <span className={s.heroName}>{h.name}</span>
                  <span className={s.kingdom}>{kingdomName(h.kingdom)}</span>
                </span>
                <span className={s.heroMeta}>
                  <Beads hp={h.max_hp} max={h.max_hp} />
                  <span>{tMaybe(`gender.${h.gender}`) ?? h.gender}</span>
                </span>
                {h.skills.map((sk) => (
                  <span key={sk.id} className={s.skill}>
                    <span className={s.skillHead}>
                      <b className={s.skillName}>{sk.title ?? sk.id}</b>
                      {sk.tags.map((tag) => (
                        <span key={tag} className={s.tag}>
                          {tMaybe(`tag.${tag}`) ?? tag}
                        </span>
                      ))}
                    </span>
                    <span className={s.skillText}>{sk.text}</span>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export function GameOver({ view, room, name, onClose }: { view: GameView; room: RoomInfo; name: (s: number) => string; onClose: () => void }) {
  useContent();
  const result = view.result!;
  const isHost = room.you === room.host;
  const won = result.winners.includes(view.you);
  return (
    <Modal
      open
      title={won ? t("over.victory") : t("over.defeat")}
      description={t("over.wins", { side: tMaybe(`side.${result.side}`) ?? result.side })}
      onClose={onClose}
      className={`${s.over} game-over`}
    >
      <ul className={s.results}>
        {view.players.map((p) => (
          <li key={p.seat} className={`${s.result} ${result.winners.includes(p.seat) ? s.winner : ""}`}>
            <RoleSeal role={p.role} />
            <span className={s.resultName}>{name(p.seat)}</span>
            <span className={s.resultHero}>{heroName(p.hero)}</span>
            <span className={s.resultState}>{p.alive ? t("over.alive") : t("over.fallen")}</span>
          </li>
        ))}
      </ul>
      <div className={s.actions}>
        {isHost ? (
          <Button variant="primary" onClick={() => send({ type: "start" })}>
            {t("lobby.rematch")}
          </Button>
        ) : (
          <span className={s.wait}>{t("over.waitRematch")}</span>
        )}
        <Button onClick={onClose}>{t("over.look")}</Button>
      </div>
    </Modal>
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
