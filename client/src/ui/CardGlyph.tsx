// Ink-wash placeholder art for cards: one brush glyph per card (by name, then by type).
// Replaced automatically by /art/cards/<id>.png when that file exists (see Art.tsx).
import type { ReactElement } from "react";

const INK = "currentColor";

const GLYPHS: Record<string, ReactElement> = {
  // A sweeping blade stroke with an ink echo (not a circle-and-bar, which reads as "prohibited").
  strike: (
    <>
      <path d="M12 38c6-8 13-15 26-24" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" opacity=".3" />
      <path d="M6 33C15 24 24 15 37 6" fill="none" stroke="var(--ik-vermilion)" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M31 6h6v6" fill="none" stroke="var(--ik-vermilion)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  dodge: <path d="M33 9C24 3 9 7 7 20c-2 13 11 21 22 16 8-4 10-14 6-21" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity=".55" />,
  peach: (
    <>
      <path d="M22 38c-9-2-15-9-14-17 1-6 7-9 14-6 7-3 13 0 14 6 1 8-5 15-14 17Z" fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" opacity=".55" />
      <path d="M22 15c0-4 2-8 6-10M22 13c-2-5-7-7-11-5 2 4 6 6 11 5Z" fill="none" stroke="var(--ik-jade)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  nullify: (
    <>
      <circle cx="22" cy="22" r="13" fill="none" stroke={INK} strokeWidth="2.2" opacity=".45" />
      <path d="M13 13 31 31M31 13 13 31" stroke={INK} strokeWidth="2.6" strokeLinecap="round" opacity=".55" />
    </>
  ),
  lightning: <path d="M25 5 12 24h9l-3 15 14-20h-9l2-14Z" fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" opacity=".6" />,
  indulgence: (
    <>
      <path d="M12 9h20l-3 13a7 7 0 0 1-14 0L12 9Z" fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" opacity=".55" />
      <path d="M22 29v7M15 37h14" stroke={INK} strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
    </>
  ),
  duel: <path d="M10 34 28 16M34 34 16 16M24 12l8 8M20 12l-8 8" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" opacity=".55" />,
  barbarians: <path d="M8 34c6-10 10-14 14-26 4 12 8 16 14 26M15 34c3-6 5-9 7-15 2 6 4 9 7 15" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />,
  arrows: <path d="M8 36 26 18M16 36 34 18M8 28 26 10M22 10h6v6M30 18h6v6M22 18h6" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" opacity=".55" />,
  ex_nihilo: (
    <>
      <circle cx="22" cy="22" r="13" fill="none" stroke={INK} strokeWidth="2" strokeDasharray="3 4" opacity=".45" />
      <path d="M22 15v14M15 22h14" stroke={INK} strokeWidth="2.6" strokeLinecap="round" opacity=".55" />
    </>
  ),
  eight_trigrams: (
    <>
      <path d="M22 6 36 14v16l-14 8-14-8V14Z" fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" opacity=".55" />
      <circle cx="22" cy="22" r="5" fill="none" stroke={INK} strokeWidth="2" opacity=".5" />
    </>
  ),
  benevolent_shield: <path d="M22 6 35 11v10c0 9-6 15-13 17-7-2-13-8-13-17V11Z" fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" opacity=".55" />,
  plus_horse: <path d="M10 30c4-12 10-18 20-18l4 6-6 2 2 10M12 22h8M16 18v8" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />,
  minus_horse: <path d="M10 30c4-12 10-18 20-18l4 6-6 2 2 10M12 22h8" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />,
};

const BY_TYPE: Record<string, ReactElement> = {
  basic: GLYPHS.dodge,
  trick: (
    <>
      <path d="M6 28c0-8 10-10 12-4 1-10 14-12 15-2 7-2 9 8 2 10H10c-3 0-4-2-4-4Z" fill="none" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" opacity=".55" />
      <path d="M14 37c6-3 12 3 18 0" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" opacity=".4" />
    </>
  ),
  equipment: <path d="M10 34 30 14M28 10l6 6M14 26l4 4M8 36l4-4" fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" opacity=".55" />,
};

export function CardGlyph({ name, type, size = 40 }: { name: string; type?: string; size?: number }) {
  const glyph = GLYPHS[name] ?? BY_TYPE[type ?? "basic"] ?? BY_TYPE.basic;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
      {glyph}
    </svg>
  );
}
