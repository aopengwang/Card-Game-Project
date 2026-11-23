import { useEffect, useRef, useState } from "react";
import { heroInfo, kingdomName, roleName, skillText, skillTitle, useContent } from "../content";
import { t, tMaybe } from "../i18n";
import type { PlayerView } from "../types";
import { Art } from "./Art";
import { CardChip } from "./CardView";

interface Props {
  player: PlayerView;
  name: string;
  isYou?: boolean;
  isCurrent: boolean;
  isWaitedOn: boolean;
  offline?: boolean;
  clickable: boolean;
  selected: boolean;
  onClick?: () => void;
}

/** Briefly returns "hit" / "heal" after HP drops / rises. */
function useHpFlash(hp: number): string {
  const prev = useRef(hp);
  const [flash, setFlash] = useState("");
  useEffect(() => {
    if (hp === prev.current) return;
    setFlash(hp < prev.current ? "hit" : "heal");
    prev.current = hp;
    const id = setTimeout(() => setFlash(""), 700);
    return () => clearTimeout(id);
  }, [hp]);
  return flash;
}

export function Seat({ player: p, name, isYou, isCurrent, isWaitedOn, offline, clickable, selected, onClick }: Props) {
  useContent();
  const hero = heroInfo(p.hero);
  const flash = useHpFlash(p.hp);
  const cls = [
    "seat",
    `kingdom-${p.kingdom || "none"}`,
    isYou ? "you" : "",
    isCurrent ? "current" : "",
    isWaitedOn ? "waited" : "",
    p.alive ? "" : "dead",
    clickable ? "clickable" : "",
    selected ? "selected" : "",
    flash,
  ].join(" ");

  const skillTip = (s: PlayerView["skills"][number]) => {
    const tags = s.tags.map((tag) => tMaybe(`tag.${tag}`) ?? tag);
    const text = skillText(s.id) ?? s.text; // the game view carries English; prefer the current language
    return `${skillTitle(s.id)}${tags.length ? ` (${tags.join(", ")})` : ""}: ${text}`;
  };

  const inner = (
    <>
      <div className="seat-top">
        <Art
          kind="heroes"
          id={p.hero}
          className="portrait"
          fallback={<span className="portrait-initial">{hero ? hero.name[0] : "?"}</span>}
        />
        <div className="seat-id">
          <div className="seat-name">
            {name}
            {isYou && <span className="badge">{t("badge.you")}</span>}
            {offline && <span className="badge warn">{t("badge.offline")}</span>}
          </div>
          <div className="seat-hero">
            {hero ? hero.name : t("seat.choosing")}
            {p.kingdom && <span className={`kingdom-tag k-${p.kingdom}`}>{kingdomName(p.kingdom)}</span>}
          </div>
        </div>
        <div className={`role ${p.role ? `role-${p.role}` : "role-hidden"}`} title={p.role ? roleName(p.role) : t("seat.hiddenRole")}>
          {p.role ? roleName(p.role) : "?"}
        </div>
      </div>
      <div className="seat-stats">
        <span className="hp" aria-label={t("seat.hp", { hp: p.hp, max: p.max_hp })}>
          {Array.from({ length: Math.max(p.max_hp, 0) }, (_, i) => (
            <span key={i} className={i < p.hp ? "pip on" : "pip"} />
          ))}
        </span>
        <span className="hand-count" title={t("seat.handCount")}>
          🂠 {p.hand_count}
        </span>
        {p.distance != null && (
          <span className="distance" title={t("seat.distance")}>
            ↔ {p.distance}
          </span>
        )}
      </div>
      {p.equips.length > 0 && (
        <div className="seat-row">
          {p.equips.map((c) => (
            <CardChip key={c.id} card={c} />
          ))}
        </div>
      )}
      {p.judge.length > 0 && (
        <div className="seat-row judge">
          {p.judge.map((c) => (
            <CardChip key={c.id} card={c} />
          ))}
        </div>
      )}
      {p.skills.length > 0 && (
        <div className="seat-row skills">
          {p.skills.map((s) => (
            <span key={s.id} className={`skill-tag ${p.spent.includes(s.id) ? "spent" : ""}`} title={skillTip(s)}>
              {skillTitle(s.id)}
            </span>
          ))}
        </div>
      )}
      {!p.alive && <div className="dead-mark">{t("seat.fallen")}</div>}
    </>
  );

  if (clickable && onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-pressed={selected}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
