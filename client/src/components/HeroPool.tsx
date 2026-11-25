import { useContent } from "../content";
import { t, useLang } from "../i18n";
import { send } from "../net";
import type { RoomInfo } from "../types";
import { Button } from "../ui/Button";
import { HeroFace, SkillsTip } from "../ui/Plaque";
import { Tip } from "../ui/Tip";
import s from "./HeroPool.module.css";
import sc from "./Screens.module.css";

/**
 * Which heroes can be picked in this room's draft: every hero as a small card, skills on
 * hover. The host clicks a card to leave that hero out (or put it back); everyone else
 * sees the choice.
 */
export function HeroPool({ room }: { room: RoomInfo }) {
  useLang();
  const { heroes } = useContent();
  if (!heroes.length || !room.disabled_heroes) return null;
  const off = new Set(room.disabled_heroes);
  const editable = room.you === room.host && room.status !== "playing";
  const on = heroes.filter((h) => !off.has(h.id)).length;
  const players = room.members.length;
  const send_ = (disabled: string[]) => send({ type: "heroes", disabled });

  return (
    <section className={`${sc.panel} ${s.pool} hero-pool`} aria-labelledby="hero-pool-title">
      <div className={s.head}>
        <h2 id="hero-pool-title" className={sc.subhead}>
          {t("heroes.title")} <span className={sc.count}>{t("heroes.count", { n: on, total: heroes.length })}</span>
        </h2>
        {editable && (
          <div className={s.actions}>
            {off.size > 0 && (
              <Button shape="small" variant="ghost" onClick={() => send_([])}>
                {t("heroes.all")}
              </Button>
            )}
            {on > 0 && (
              <Button shape="small" variant="ghost" onClick={() => send_(heroes.map((h) => h.id))}>
                {t("heroes.none")}
              </Button>
            )}
          </div>
        )}
      </div>
      <p className={sc.note}>{editable ? t("heroes.hostHint") : t("heroes.guestHint")}</p>
      <ul className={s.grid}>
        {heroes.map((h) => {
          const enabled = !off.has(h.id);
          const cls = `${s.hero} ${enabled ? "" : `${s.off} is-off`} pool-hero`;
          const face = <HeroFace hero={h.id} kingdom={h.kingdom} title={h.name} />;
          return (
            <li key={h.id}>
              <Tip content={<SkillsTip skills={h.skills} />} side="top">
                {editable ? (
                  <button
                    type="button"
                    className={cls}
                    data-hero={h.id}
                    aria-label={h.name}
                    aria-pressed={enabled}
                    onClick={() => send_(enabled ? [...off, h.id] : [...off].filter((id) => id !== h.id))}
                  >
                    {face}
                  </button>
                ) : (
                  <span className={cls} data-hero={h.id} tabIndex={0} role="group" aria-label={`${h.name}: ${t(enabled ? "heroes.on" : "heroes.off")}`}>
                    {face}
                  </span>
                )}
              </Tip>
            </li>
          );
        })}
      </ul>
      {on < players && <p className={`${sc.note} ${s.warn}`}>{t("heroes.tooFew", { n: players })}</p>}
    </section>
  );
}
