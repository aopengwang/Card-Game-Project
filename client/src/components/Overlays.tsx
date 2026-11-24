import { useEffect, useRef } from "react";
import { heroInfo, heroName, useContent } from "../content";
import { describe, type LogLine } from "../describe";
import { getLang, serverText, t, tMaybe, useLang } from "../i18n";
import { answer, send } from "../net";
import type { ChooseHeroReq, GameView, LogEntry, RoomInfo } from "../types";
import { Beads, RoleSeal } from "../ui/Bits";
import { HeroFace } from "../ui/Plaque";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import s from "./Overlays.module.css";

export function HeroPick({ req, isLordPick }: { req: ChooseHeroReq; isLordPick: boolean }) {
  useContent();
  return (
    <Modal open wide dismissible={false} title={t("hero.choose")} description={isLordPick ? t("hero.lordNote") : t("hero.otherNote")}>
      {req.error && <div className={s.error}>{serverText(req.error)}</div>}
      <div className={s.heroGrid}>
        {req.options.map((id) => (
          <HeroCard key={id} id={id} onClick={() => answer(id)} />
        ))}
      </div>
    </Modal>
  );
}

/** A hero to choose: portrait, name, kingdom, HP, skills (hero pick; also the gallery). */
export function HeroCard({ id, onClick }: { id: string; onClick?: () => void }) {
  useContent();
  const h = heroInfo(id);
  if (!h) return null;
  return (
    <button type="button" className={`${s.heroCard} hero-card`} data-hero={id} onClick={onClick}>
      {/* the same hero card as at the table; here the skills are listed underneath */}
      <HeroFace hero={id} kingdom={h.kingdom} title={h.name} />
      <span className={s.heroBody}>
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
}

export function GameOver({ view, room, name, onClose }: { view: GameView; room: RoomInfo; name: (s: number) => string; onClose: () => void }) {
  useContent();
  const result = view.result!;
  const isHost = room.you === room.host;
  const won = result.winners.includes(view.you);
  const zh = getLang() === "zh";
  const groups = [
    { key: "winners", label: t("over.winners"), players: view.players.filter((p) => result.winners.includes(p.seat)) },
    { key: "losers", label: t("over.losers"), players: view.players.filter((p) => !result.winners.includes(p.seat)) },
  ].filter((g) => g.players.length);
  return (
    <Modal
      open
      title={won ? t("over.victory") : t("over.defeat")}
      description={`${t("over.wins", { side: tMaybe(`side.${result.side}`) ?? result.side })} ${t("over.turns", { n: view.turn })}`}
      onClose={onClose}
      className={`${s.over} ${won ? s.won : s.lost} game-over`}
    >
      {/* the verdict, pressed like a seal: 胜 / 败 */}
      <span className={s.verdict} lang="zh-CN" aria-hidden="true">
        {won ? "胜" : "败"}
      </span>
      {groups.map((g) => (
        <section key={g.key} className={s.group}>
          <h3 className={s.groupLabel}>{g.label}</h3>
          <ul className={s.results}>
            {g.players.map((p) => {
              const kingdom = heroInfo(p.hero)?.kingdom ?? "";
              return (
                <li
                  key={p.seat}
                  className={`${s.result} ${g.key === "winners" ? s.winner : ""} ${p.seat === view.you ? s.mine : ""} ${s[kingdom] ?? ""}`}
                >
                  <RoleSeal role={p.role} />
                  <span className={s.resultName}>
                    {name(p.seat)}
                    {p.seat === view.you && <span className={s.youBadge}>{t("badge.you")}</span>}
                  </span>
                  <span className={s.resultHero} lang={zh ? "zh-CN" : undefined}>
                    {heroName(p.hero)}
                  </span>
                  <span className={`${s.resultState} ${p.alive ? "" : s.fallen}`}>{p.alive ? t("over.alive") : t("over.fallen")}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
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
