import { useEffect, useRef, useState, type ReactElement } from "react";
import { cardInfo, cardTitle, heroInfo, kingdomName, sealChar, skillText, skillTitle, useContent } from "../content";
import { getLang, t, tMaybe } from "../i18n";
import type { Card as CardData, PlayerView } from "../types";
import { Beads, Portrait, RoleSeal } from "./Bits";
import { CardTip } from "./Card";
import { CardGlyph } from "./CardGlyph";
import { Tip, TipBody } from "./Tip";
import s from "./Plaque.module.css";

interface Props {
  player: PlayerView;
  name: string;
  variant?: "seat" | "self";
  isYou?: boolean;
  isCurrent?: boolean;
  isWaitedOn?: boolean;
  offline?: boolean;
  clickable?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

/** True for a moment after HP drops (drives the shake). */
function useHit(hp: number): boolean {
  const last = useRef(hp);
  const [hit, setHit] = useState(false);
  useEffect(() => {
    const dropped = hp < last.current;
    last.current = hp;
    if (!dropped) return;
    setHit(true);
    const id = setTimeout(() => setHit(false), 450);
    return () => clearTimeout(id);
  }, [hp]);
  return hit;
}

const SLOT_ORDER = ["weapon", "armor", "plus_horse", "minus_horse"] as const;

const SLOT_ICON: Record<(typeof SLOT_ORDER)[number], ReactElement> = {
  weapon: <path d="M3 13 11 5M10 3l3 3M5 9l2 2M2 14l2-2" />,
  armor: <path d="M8 2 13 4v4c0 3-2 5-5 6-3-1-5-3-5-6V4Z" />,
  plus_horse: <path d="M4 8h8M8 4v8" />,
  minus_horse: <path d="M4 8h8" />,
};

function EquipSlots({ equips }: { equips: CardData[] }) {
  const bySlot = new Map(equips.map((c) => [cardInfo(c.name)?.slot ?? "", c]));
  return (
    <div className={s.slots}>
      {SLOT_ORDER.map((slot) => {
        const card = bySlot.get(slot);
        const icon = (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {SLOT_ICON[slot]}
          </svg>
        );
        const slotName = tMaybe(`slot.${slot}`) ?? slot;
        if (!card) {
          return (
            <span key={slot} className={s.slot} role="img" aria-label={`${slotName}: ${t("slot.empty")}`}>
              {icon}
            </span>
          );
        }
        const range = cardInfo(card.name)?.range;
        return (
          <Tip key={slot} content={<CardTip name={card.name} />}>
            <span className={`${s.slot} ${s.slotFull}`} role="img" aria-label={`${slotName}: ${cardTitle(card.name)}`}>
              {icon}
              {slot === "weapon" && range ? <span>{range}</span> : null}
            </span>
          </Tip>
        );
      })}
    </div>
  );
}

function JudgeCards({ cards }: { cards: CardData[] }) {
  if (!cards.length) return null;
  const zh = getLang() === "zh";
  return (
    <div className={s.judge}>
      {cards.map((c) => (
        <Tip key={c.id} content={<CardTip name={c.name} />}>
          <span className={`${s.judgeCard} judge-card`} role="img" aria-label={cardTitle(c.name)} lang={zh ? "zh-CN" : undefined}>
            {zh ? sealChar("card", c.name) : <CardGlyph name={c.name} type="trick" size={18} />}
          </span>
        </Tip>
      ))}
    </div>
  );
}

/** A player's seat: portrait, role seal, name/hero, HP beads, equipment, skills. */
export function Plaque({ player: p, name, variant = "seat", isYou, isCurrent, isWaitedOn, offline, clickable, selected, onClick }: Props) {
  useContent();
  const hero = heroInfo(p.hero);
  const hit = useHit(p.hp);
  const dying = p.alive && p.hp <= 0;
  const self = variant === "self";
  const cls = [
    s.plaque,
    s[p.kingdom] ?? "",
    self ? s.self : "",
    isCurrent ? s.current : "",
    isWaitedOn ? s.waited : "",
    clickable ? s.clickable : "",
    selected ? s.selected : "",
    dying ? s.dying : "",
    hit ? s.hit : "",
    p.alive ? "" : s.dead,
    // stable hooks for tests / layout
    "seat",
    clickable ? "clickable" : "",
    selected ? "selected" : "",
    isCurrent ? "current" : "",
    p.alive ? "" : "dead",
  ].join(" ");

  const inner = (
    <>
      <div className={s.top}>
        <Portrait hero={p.hero} width="100%" height={self ? 118 : 88} />
        <span className={s.seal}>
          <RoleSeal role={p.role} />
        </span>
        <JudgeCards cards={p.judge} />
      </div>
      <div className={s.info}>
        <div className={s.nameRow}>
          <span className={s.name}>{name}</span>
          {isYou && <span className={s.badge}>{t("badge.you")}</span>}
          {offline && <span className={`${s.badge} ${s.badgeWarn}`}>{t("badge.offline")}</span>}
        </div>
        <div className={s.heroRow}>
          <span className={s.heroName}>{hero ? hero.name : t("seat.choosing")}</span>
          {p.kingdom && <span className={s.kingdom}>{kingdomName(p.kingdom)}</span>}
        </div>
        <div className={s.stats}>
          <Beads hp={p.hp} max={p.max_hp} size={self ? "lg" : "md"} dying={dying} />
          <span className={s.stat} title={t("seat.handCount")} aria-label={`${t("seat.handCount")}: ${p.hand_count}`}>
            <svg width="11" height="13" viewBox="0 0 11 13" aria-hidden="true">
              <rect x="0.75" y="0.75" width="9.5" height="11.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            {p.hand_count}
          </span>
          {p.distance != null && (
            <span className={s.stat} title={t("seat.distance")} aria-label={`${t("seat.distance")}: ${p.distance}`}>
              ↔ {p.distance}
            </span>
          )}
        </div>
        <EquipSlots equips={p.equips} />
        {p.skills.length > 0 && (
          <div className={s.skills}>
            {p.skills.map((sk) => {
              const tags = sk.tags.map((tag) => tMaybe(`tag.${tag}`) ?? tag);
              return (
                <Tip key={sk.id} content={<TipBody title={skillTitle(sk.id)} tags={tags} text={skillText(sk.id) ?? sk.text} />}>
                  <span className={`${s.skill} ${p.spent.includes(sk.id) ? s.skillSpent : ""}`} tabIndex={clickable ? undefined : 0}>
                    {skillTitle(sk.id)}
                  </span>
                </Tip>
              );
            })}
          </div>
        )}
      </div>
      {!p.alive && (
        <span className={s.stamp} lang={getLang() === "zh" ? "zh-CN" : undefined}>
          {t("seat.fallen")}
        </span>
      )}
    </>
  );

  if (clickable && onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-pressed={!!selected} aria-label={name}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}
