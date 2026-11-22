import { useEffect, useRef, useState } from "react";
import { KINGDOM_NAME, heroInfo, titleCase, useContent } from "../content";
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
    const t = setTimeout(() => setFlash(""), 700);
    return () => clearTimeout(t);
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
            {isYou && <span className="badge">you</span>}
            {offline && <span className="badge warn">offline</span>}
          </div>
          <div className="seat-hero">
            {hero ? `${hero.name}` : "Choosing…"}
            {p.kingdom && <span className={`kingdom-tag k-${p.kingdom}`}>{KINGDOM_NAME[p.kingdom] ?? p.kingdom}</span>}
          </div>
        </div>
        <div className={`role ${p.role ? `role-${p.role}` : "role-hidden"}`} title={p.role ? titleCase(p.role) : "Hidden role"}>
          {p.role ? titleCase(p.role) : "?"}
        </div>
      </div>
      <div className="seat-stats">
        <span className="hp" aria-label={`${p.hp} of ${p.max_hp} HP`}>
          {Array.from({ length: Math.max(p.max_hp, 0) }, (_, i) => (
            <span key={i} className={i < p.hp ? "pip on" : "pip"} />
          ))}
        </span>
        <span className="hand-count" title="Cards in hand">
          🂠 {p.hand_count}
        </span>
        {p.distance != null && (
          <span className="distance" title="Your distance to this player">
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
            <span key={s.id} className={`skill-tag ${p.spent.includes(s.id) ? "spent" : ""}`} title={`${titleCase(s.id)}${s.tags.length ? ` (${s.tags.join(", ")})` : ""}: ${s.text}`}>
              {titleCase(s.id)}
            </span>
          ))}
        </div>
      )}
      {!p.alive && <div className="dead-mark">Fallen</div>}
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
