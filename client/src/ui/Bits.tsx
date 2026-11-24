// Small Ink & Lacquer pieces: jade HP beads, role seals, the timer ring, hero portraits.
import { useEffect, useRef, useState } from "react";
import { heroInfo, roleName, sealChar, useContent } from "../content";
import { getLang, t } from "../i18n";
import { Art } from "../components/Art";
import { Tip } from "./Tip";
import s from "./Bits.module.css";

// ---------------------------------------------------------------- HP beads

/** Remembers the previous HP so beads can crack (damage) or glow (healing). */
function useHpChange(hp: number): { prev: number; kind: "" | "hit" | "heal" } {
  const last = useRef(hp);
  const [change, setChange] = useState<{ prev: number; kind: "" | "hit" | "heal" }>({ prev: hp, kind: "" });
  useEffect(() => {
    if (hp === last.current) return;
    setChange({ prev: last.current, kind: hp < last.current ? "hit" : "heal" });
    last.current = hp;
    const id = setTimeout(() => setChange({ prev: hp, kind: "" }), 800);
    return () => clearTimeout(id);
  }, [hp]);
  return change;
}

export function Beads({ hp, max, size = "md", dying }: { hp: number; max: number; size?: "md" | "lg"; dying?: boolean }) {
  const { prev, kind } = useHpChange(hp);
  return (
    <span className={`${s.beads} ${size === "lg" ? s.lg : ""} ${dying ? s.dying : ""} hp`} role="img" aria-label={t("seat.hp", { hp, max })}>
      {Array.from({ length: Math.max(max, 0) }, (_, i) => {
        const lost = kind === "hit" && i >= hp && i < prev;
        const gained = kind === "heal" && i < hp && i >= prev;
        return <span key={i} className={`${s.bead} ${i < hp ? s.on : ""} ${lost ? s.lost : ""} ${gained ? s.gained : ""}`} />;
      })}
    </span>
  );
}

// ---------------------------------------------------------------- role seals

const ROLE_ZH: Record<string, string> = { lord: "主", loyalist: "忠", rebel: "反", spy: "内" };

/** Role seal: a square seal character in Chinese, a seal-styled word in English. */
export function RoleSeal({ role, size = "md", onDark }: { role: string | null; size?: "md" | "lg"; onDark?: boolean }) {
  const zh = getLang() === "zh";
  const name = role ? roleName(role) : t("seat.hiddenRole");
  const cls = [
    s.seal,
    zh ? s.sealZh : s.sealEn,
    size === "lg" ? s.sealLg : "",
    role ? s[role] ?? "" : s.hidden,
    onDark ? s.onDark : "",
    "role",
    role ? `role-${role}` : "role-hidden",
  ].join(" ");
  const text = role ? (zh ? ROLE_ZH[role] ?? name : name) : "?";
  return (
    <Tip content={<span>{name}</span>}>
      <span className={cls} role="img" aria-label={name} lang={zh ? "zh-CN" : undefined}>
        {text}
      </span>
    </Tip>
  );
}

// ---------------------------------------------------------------- timer ring

export function TimerRing({ deadline, total, size = 42 }: { deadline: number; total: number; size?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, deadline - now);
  const frac = total > 0 ? left / total : 0;
  const secs = Math.ceil(left / 1000);
  const stroke = Math.max(3, Math.round(size / 10));
  const r = size / 2 - stroke;
  const circ = 2 * Math.PI * r;
  return (
    <span
      className={`${s.timer} ${frac < 0.25 ? s.low : ""} timer`}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={t("act.secondsLeft", { n: secs })}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className={s.ringTrack} cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className={s.ringFill}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className={s.timerText}>{secs}</span>
    </span>
  );
}

// ---------------------------------------------------------------- portraits

/** Hero portrait: /art/heroes/<id>.png if present, else a brush character on ink-wash paper. */
export function Portrait({ hero, width, height, charSize }: { hero: string; width: number | string; height: number; charSize?: number }) {
  useContent();
  const known = !!heroInfo(hero);
  const char = known ? sealChar("hero", hero) : "?";
  return (
    <div className={s.portrait} style={{ width, height }} aria-hidden="true">
      <svg className={s.mountains} viewBox="0 0 150 104" preserveAspectRatio="none">
        <path d="M0 80C22 64 36 58 52 70c14 10 26-16 46-22 20-6 32 14 52 8v48H0Z" fill="rgba(28,23,20,0.15)" />
        <path d="M0 92c30-12 52-4 74-10 26-6 46 4 76-2v24H0Z" fill="rgba(28,23,20,0.25)" />
      </svg>
      <span className={s.brushChar} style={{ fontSize: charSize ?? Math.round(height * 0.6) }} lang="zh-CN">
        {char}
      </span>
      {known && <Art kind="heroes" id={hero} fallback={null} />}
    </div>
  );
}
