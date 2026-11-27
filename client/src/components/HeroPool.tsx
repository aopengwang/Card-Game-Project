import { useContent } from "../content";
import { t, useLang } from "../i18n";
import { send } from "../net";
import type { HeroInfo, RoomInfo } from "../types";
import { Button } from "../ui/Button";
import { HeroFace, SkillsTip } from "../ui/Plaque";
import { Tip } from "../ui/Tip";
import s from "./HeroPool.module.css";
import sc from "./Screens.module.css";

/**
 * Which heroes can be picked in this room's draft: every hero as a small card, skills on
 * hover, in two groups (the classic heroes, and our table's custom ones). The host clicks a
 * card to leave that hero out (or put it back), or uses a group's buttons to play with only
 * that group, or to add / remove it as a whole; everyone else sees the choice.
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
  const groups = [
    { key: "classic", list: heroes.filter((h) => !h.custom) },
    { key: "custom", list: heroes.filter((h) => h.custom) },
  ].filter((g) => g.list.length);

  const card = (h: HeroInfo) => {
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
  };

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
      {groups.map((g) => {
        const ids = g.list.map((h) => h.id);
        const inGroup = new Set(ids);
        const groupOn = ids.filter((id) => !off.has(id)).length;
        const name = t(g.key === "custom" ? "heroes.custom" : "heroes.classic");
        const others = heroes.filter((h) => !inGroup.has(h.id)).map((h) => h.id);
        const onlyThese = groupOn === ids.length && others.every((id) => off.has(id));
        return (
          <div key={g.key} className={`${s.group} hero-group`} data-group={g.key} role="group" aria-label={name}>
            <div className={s.groupHead}>
              <h3 className={s.groupTitle}>
                {name} <span className={sc.count}>{t("heroes.count", { n: groupOn, total: ids.length })}</span>
              </h3>
              {editable && (
                <div className={s.actions}>
                  {!onlyThese && (
                    <Button shape="small" variant="ghost" onClick={() => send_(others)}>
                      {t("heroes.only")}
                    </Button>
                  )}
                  {groupOn < ids.length && (
                    <Button shape="small" variant="ghost" onClick={() => send_([...off].filter((id) => !inGroup.has(id)))}>
                      {t("heroes.addGroup")}
                    </Button>
                  )}
                  {groupOn > 0 && (
                    <Button shape="small" variant="ghost" onClick={() => send_([...new Set([...off, ...ids])])}>
                      {t("heroes.removeGroup")}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <ul className={s.grid}>{g.list.map(card)}</ul>
          </div>
        );
      })}
      {on < players && <p className={`${sc.note} ${s.warn}`}>{t("heroes.tooFew", { n: players })}</p>}
    </section>
  );
}
