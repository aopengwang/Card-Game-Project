import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
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
  /** Your attack range (shown on your own plaque). */
  range?: number;
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

/** Screen-reader name for a seat's card: the skills, since they're no longer printed. */
const skillsLabel = (p: PlayerView) => `${t("seat.skills")}: ${p.skills.map((sk) => skillTitle(sk.id)).join(", ")}`;

/** A hero's skills, full rules: shown when you hover or focus a hero card. */
export function SkillsTip({ skills, spent = [] }: { skills: PlayerView["skills"]; spent?: string[] }) {
  return (
    <span className={s.skillsTip}>
      {skills.map((sk) => {
        const tags = sk.tags.map((tag) => tMaybe(`tag.${tag}`) ?? tag);
        if (spent.includes(sk.id)) tags.push(t("seat.used"));
        return <TipBody key={sk.id} title={skillTitle(sk.id)} tags={tags} text={skillText(sk.id) ?? sk.text} />;
      })}
    </span>
  );
}

/**
 * The face of a hero card: art across the whole 5:7 card (your portrait, or the ink scene
 * with the hero's brush character), kingdom badge top-left, role seal top-right, and a
 * frosted name strip along the bottom. Used by seats and by hero pick.
 */
export function HeroFace({
  hero,
  kingdom,
  role,
  title,
  subtitle,
  badges,
  judge,
  children,
  className,
}: {
  hero: string;
  kingdom: string;
  role?: string | null;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  judge?: CardData[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${s.face} ${s[kingdom] ?? ""} ${className ?? ""} hero-face`}>
      <Portrait hero={hero} width="100%" height="100%" charSize="58cqw" />
      {kingdom && <span className={s.faction}>{kingdomName(kingdom)}</span>}
      {role !== undefined && (
        <span className={s.role}>
          <RoleSeal role={role} />
        </span>
      )}
      {judge && <JudgeCards cards={judge} />}
      <span className={s.nameplate}>
        <span className={s.nameRow}>
          <span className={s.name}>{title}</span>
          {badges}
        </span>
        {subtitle && <span className={s.heroName}>{subtitle}</span>}
      </span>
      {children}
    </span>
  );
}

/**
 * A player's seat, laid out like the hero card template: the 5:7 hero card, then HP and
 * hand count, then the four equipment slots. Skills appear on hover (SkillsTip). The rows
 * under the card have a fixed height (PLAQUE_INFO_H), so a seat is always card + rows
 * tall: nothing a player gains makes it grow, and seats never shift.
 */
export function Plaque({ player: p, name, variant = "seat", isYou, isCurrent, isWaitedOn, offline, clickable, selected, onClick, range }: Props) {
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

  const face = (
    <HeroFace
      hero={p.hero}
      kingdom={p.kingdom}
      role={p.role}
      judge={p.judge}
      title={name}
      subtitle={hero ? hero.name : t("seat.choosing")}
      badges={
        <>
          {isYou && <span className={s.badge}>{t("badge.you")}</span>}
          {offline && <span className={`${s.badge} ${s.badgeWarn}`}>{t("badge.offline")}</span>}
        </>
      }
    >
      {!p.alive && (
        <span className={s.stamp} lang={getLang() === "zh" ? "zh-CN" : undefined}>
          {t("seat.fallen")}
        </span>
      )}
    </HeroFace>
  );

  const inner = (
    <>
      {/* hover or focus the card for the hero's skills */}
      {p.skills.length > 0 ? (
        <Tip content={<SkillsTip skills={p.skills} spent={p.spent} />} side="right">
          <span className={s.faceWrap} tabIndex={clickable ? undefined : 0} role="group" aria-label={skillsLabel(p)}>
            {face}
          </span>
        </Tip>
      ) : (
        <span className={s.faceWrap}>{face}</span>
      )}
      <div className={s.info}>
        <div className={s.stats}>
          <Beads hp={p.hp} max={p.max_hp} size={self ? "lg" : "md"} dying={dying} />
          <span className={s.spacer} />
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
          {range != null && (
            <span className={s.stat} title={t("table.range", { n: range })} aria-label={t("table.range", { n: range })}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                {SLOT_ICON.weapon}
              </svg>
              {range}
            </span>
          )}
        </div>
        <EquipSlots equips={p.equips} />
      </div>
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
