/*
 * Built-in card illustrations: one ink-wash scene per card, drawn as SVG so they're
 * ours, crisp at any size, and themed by the palette tokens. Every scene shares the same
 * language: pale distant hills, mist, a dark-ink subject, one vermilion accent.
 *
 * An image dropped in client/public/art/cards/<id>.(png|jpg|webp) replaces the scene for
 * that card (see Card.tsx and art.ts). docs/art-prompts.md describes each scene, for
 * anyone making painted versions.
 */
import type { ReactElement, ReactNode } from "react";

const INK = "var(--ik-ink)";
const RED = "var(--ik-vermilion)";
const JADE = "var(--ik-jade)";
const GOLD = "var(--ik-gold-muted)";
const PAPER = "var(--ik-paper)";

// ---------------------------------------------------------------- shared brush pieces

/** Two ranges of distant hills: every scene's backdrop. */
const Hills = ({ far = 0.08, near = 0.13 }: { far?: number; near?: number }) => (
  <>
    <path d="M0 60C12 50 20 45 30 52s18-12 30-9 18-8 30-2 20 8 30 6v37H0Z" fill={INK} opacity={far} />
    <path d="M0 72c18-8 32-3 48-7 20-5 36 4 72-3v22H0Z" fill={INK} opacity={near} />
  </>
);

/** Bands of mist drifting across the scene. */
const Mist = ({ y = 58 }: { y?: number }) => (
  <path d={`M-4 ${y}c20-3 34 2 52-1M60 ${y + 6}c18-3 34 1 64-2`} stroke={PAPER} strokeWidth="4" strokeLinecap="round" opacity=".75" fill="none" />
);

/** The red sun, the one warm accent most scenes share. */
const Sun = ({ x = 92, y = 22, r = 9 }: { x?: number; y?: number; r?: number }) => <circle cx={x} cy={y} r={r} fill={RED} opacity=".8" />;

/** A straight double-edged sword (jian), pointing up from (0,0); place it with `at`. */
function Jian({ at, len = 58, tassel = true, edge }: { at: string; len?: number; tassel?: boolean; edge?: string }) {
  return (
    <g transform={at}>
      <path d={`M-2.6 0V${-len + 7}L0 ${-len}l2.6 7V0Z`} fill={edge ?? INK} />
      <path d={`M0 -2V${-len + 6}`} stroke={PAPER} strokeWidth=".7" opacity=".55" />
      <path d="M-8 0h16l-2 3H-6Z" fill={GOLD} />
      <rect x="-1.7" y="3" width="3.4" height="11" rx="1" fill={INK} />
      <circle cx="0" cy="16" r="2.4" fill={GOLD} />
      {tassel && <path d="M0 18c-1 5 2 8-1 13M0 18c2 4 4 6 3 11" stroke={RED} strokeWidth="1.4" fill="none" strokeLinecap="round" />}
    </g>
  );
}

/** A pole arm: shaft from (0,0) up to the head drawn by `head` at the top. */
function Pole({ at, len = 70, head }: { at: string; len?: number; head: ReactNode }) {
  return (
    <g transform={at}>
      <path d={`M0 0V${-len}`} stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d={`M-2 ${-len + 4}h4`} stroke={RED} strokeWidth="3" />
      <g transform={`translate(0 ${-len})`}>{head}</g>
    </g>
  );
}

/** An arrow pointing along +x, tip at (0,0). */
const Arrow = ({ at, len = 34 }: { at: string; len?: number }) => (
  <g transform={at}>
    <path d={`M0 0H${-len}`} stroke={INK} strokeWidth="1.4" />
    <path d="M0 0l-6-2.5v5Z" fill={INK} />
    <path d={`M${-len} 0l-4-3M${-len} 0l-4 3M${-len + 4} 0l-4-3M${-len + 4} 0l-4 3`} stroke={RED} strokeWidth="1.1" />
  </g>
);

/** A horse in silhouette, facing right, in a 60x44 box: arched neck, head bowed, long legs. */
function Horse({ at, gallop }: { at: string; gallop?: boolean }) {
  const legs = gallop
    ? "M42 24l8 5 5 6M38 25l5 8-2 7M18 25l-8 6-6 2M15 23l-3 9-6 7"
    : "M42 25l1 8-1 9M38 26v16M18 25l2 8-3 9M14 23l-1 10-1 9";
  return (
    <g transform={at}>
      {/* tail */}
      <path d="M12 16c-6 1-8 8-7 16" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      {/* body, neck and head */}
      <path
        d="M12 16c8-3 18-3 26-4 3-4 6-8 9-10 3-1 5 0 6 2l4 5c1 2-1 3-3 2l-4 0c-2 3-4 7-5 11-1 3-3 4-5 4-8 1-18 1-24 0-4-1-6-5-4-10Z"
        fill={INK}
      />
      <path d={legs} fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* mane and a vermilion saddle cloth */}
      <path d="M45 4c-3 2-5 5-6 8M48 3c-2 3-4 5-5 8" stroke={PAPER} strokeWidth="1" opacity=".55" fill="none" />
      <path d="M22 12h11l-1 7H23Z" fill={RED} />
    </g>
  );
}

/** A peach with leaves, centred on (0,0). */
const Peach = ({ at, r = 1 }: { at: string; r?: number }) => (
  <g transform={`${at} scale(${r})`}>
    <path d="M0 13C-9 12-14 5-13-2c1-6 7-8 13-5 6-3 12-1 13 5 1 7-4 14-13 15Z" fill="#e9a08a" />
    <path d="M0 13C-9 12-14 5-13-2c1-6 7-8 13-5" fill={RED} opacity=".45" />
    <path d="M0-7c-1 6 0 12 0 20" stroke={RED} strokeWidth=".8" opacity=".5" fill="none" />
    <path d="M0-7c-2-5-8-7-12-4 3 4 8 5 12 4ZM1-7c2-5 8-6 11-3-3 4-8 4-11 3Z" fill={JADE} />
  </g>
);

/** An auspicious cloud scroll. */
const Cloud = ({ at, o = 0.5 }: { at: string; o?: number }) => (
  <path
    transform={at}
    d="M0 0c0-6 8-8 11-3 2-6 13-6 13 1 6-1 8 7 1 8H-1c-5 0-6-6 1-6Zm11-3c-1 3 1 5 4 4"
    fill="none"
    stroke={INK}
    strokeWidth="1.6"
    strokeLinecap="round"
    opacity={o}
  />
);

/** Water: a few curling wave lines. */
const Waves = ({ y = 66 }: { y?: number }) => (
  <path
    d={`M0 ${y}c6-4 10 4 16 0s10 4 16 0 10 4 16 0 10 4 16 0 10 4 16 0 10 4 16 0 10 4 16 0M8 ${y + 8}c6-4 10 4 16 0s10 4 16 0 10 4 16 0 10 4 16 0 10 4 16 0 10 4 16 0`}
    fill="none"
    stroke={INK}
    strokeWidth="1.3"
    opacity=".4"
  />
);

// ---------------------------------------------------------------- the scenes

const SCENES: Record<string, ReactElement> = {
  // -- basics
  strike: (
    <>
      <Hills />
      <Sun x={26} y={22} r={8} />
      <path d="M14 70C40 50 70 30 108 10" stroke={RED} strokeWidth="5" strokeLinecap="round" opacity=".85" fill="none" />
      <path d="M22 74C46 56 74 38 110 20" stroke={INK} strokeWidth="1.4" opacity=".35" fill="none" />
      <Jian at="translate(70 60) rotate(52)" len={56} />
    </>
  ),
  dodge: (
    <>
      <Hills />
      <Mist />
      <path d="M30 70c-10-18 4-40 26-42 18-2 32 10 30 24-2 12-16 16-24 8" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".55" />
      <path d="M40 66c-4-12 6-24 18-24 10 0 16 8 12 15" stroke={JADE} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <Arrow at="translate(112 30) rotate(170)" len={30} />
      <path d="M20 26l6 3M16 34l7 1M22 18l5 4" stroke={INK} strokeWidth="1.4" strokeLinecap="round" opacity=".45" />
    </>
  ),
  peach: (
    <>
      <Hills far={0.06} near={0.1} />
      <path d="M4 18c24 4 46 2 70 12 14 6 26 8 42 6" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" opacity=".75" />
      <path d="M40 22c4 6 4 12 2 18" stroke={INK} strokeWidth="1.6" fill="none" opacity=".6" />
      <Peach at="translate(42 50)" r={1.35} />
      <Peach at="translate(76 46)" r={1} />
      <path d="M22 16l4 6M60 26l-3 6M96 34l3 6" stroke={JADE} strokeWidth="3" strokeLinecap="round" />
    </>
  ),

  // -- tricks
  ex_nihilo: (
    <>
      <Hills />
      <circle cx="60" cy="40" r="22" fill="none" stroke={INK} strokeWidth="4" strokeDasharray="110 30" strokeLinecap="round" opacity=".6" />
      <rect x="44" y="30" width="14" height="20" rx="2" fill={PAPER} stroke={INK} strokeWidth="1.2" transform="rotate(-12 51 40)" />
      <rect x="62" y="28" width="14" height="20" rx="2" fill={PAPER} stroke={INK} strokeWidth="1.2" transform="rotate(10 69 38)" />
      <path d="M53 37l-4 6M70 34l1 7" stroke={RED} strokeWidth="2" strokeLinecap="round" />
      <path d="M38 18l3 4M84 20l-3 4M60 10v5" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  dismantle: (
    <>
      <Hills />
      <Waves y={64} />
      <path d="M6 62c10-26 30-34 46-30" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M114 62c-10-26-30-34-44-30" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M14 50v12M26 40v22M40 34v8M104 50v12M92 40v22M80 34v8" stroke={INK} strokeWidth="1.6" opacity=".6" />
      <path d="M54 40l4 10M66 38l-3 12M60 52l2 8" stroke={INK} strokeWidth="2.2" strokeLinecap="round" opacity=".7" />
      <path d="M50 30l6-4M72 28l-5-4" stroke={RED} strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  snatch: (
    <>
      <Hills />
      <Mist y={62} />
      <g transform="translate(56 34)">
        <path d="M0 10c-4 0-6-4-4-7-3-3 0-8 4-7 1-4 7-5 9-2 3-3 9-1 9 3 4 1 4 7 0 8 1 4-3 7-6 5-2 3-7 3-9 0-1 2-2 2-3 0Z" fill={PAPER} stroke={INK} strokeWidth="1.6" />
        <path d="M18 2c4-2 9 0 9 4s-4 6-8 4" fill={INK} />
        <path d="M2 11v9M8 12v9M13 12v9M17 11v9" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      </g>
      <path d="M82 40c8 0 14 6 18 16" stroke={RED} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M98 52l4 6-6-1" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  duel: (
    <>
      <Hills />
      <Sun x={60} y={34} r={16} />
      <Jian at="translate(36 64) rotate(42)" len={58} tassel={false} />
      <Jian at="translate(84 64) rotate(-42)" len={58} tassel={false} />
      <path d="M60 18v-8M44 22l-5-6M76 22l5-6" stroke={INK} strokeWidth="1.4" strokeLinecap="round" opacity=".4" />
    </>
  ),
  barbarians: (
    <>
      <path d="M0 58c10-10 18-14 26-6 8-12 20-14 30-4 10-10 24-8 34 2 10-8 22-6 30 2v32H0Z" fill={INK} opacity=".1" />
      <path d="M10 62c-2-12 2-22 8-30M18 32c-6-2-12 0-14 4M18 32c2-6 8-8 12-6M18 32c-2-6-8-8-12-6M18 32c6 0 10 4 10 8" stroke={JADE} strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M100 62c2-12-2-20-6-26M94 36c6-2 12 0 14 4M94 36c-2-6-8-8-12-6M94 36c4-4 10-4 12-2" stroke={JADE} strokeWidth="2" fill="none" strokeLinecap="round" />
      {[34, 46, 58, 70, 82].map((x, i) => (
        <g key={x} transform={`translate(${x} ${66 - (i % 2) * 6})`}>
          <path d="M0 0V-34" stroke={INK} strokeWidth="1.6" />
          <path d="M0-34l-3 6h6Z" fill={INK} />
          {i % 2 === 0 && <path d="M0-30h10l-3 4 3 4H0" fill={RED} opacity=".85" />}
        </g>
      ))}
      <path d="M0 70c30-6 80-6 120 0v14H0Z" fill={INK} opacity=".16" />
    </>
  ),
  arrows: (
    <>
      <Hills />
      {[
        [30, 22],
        [52, 14],
        [74, 24],
        [96, 16],
        [42, 40],
        [64, 34],
        [86, 42],
        [108, 34],
      ].map(([x, y]) => (
        <Arrow key={`${x}-${y}`} at={`translate(${x} ${y}) rotate(58)`} len={22} />
      ))}
      <path d="M0 76c30-4 80-4 120 0" stroke={INK} strokeWidth="1.2" opacity=".4" fill="none" />
    </>
  ),
  peach_garden: (
    <>
      <Hills far={0.06} near={0.1} />
      <path d="M60 76c-2-14 0-24 4-34M64 42c-8-8-20-8-28-4M64 42c8-10 22-12 30-6M62 52c-6-2-12 0-16 4" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="42" cy="32" r="12" fill="#e9a08a" opacity=".35" />
      <circle cx="86" cy="30" r="13" fill="#e9a08a" opacity=".35" />
      <circle cx="64" cy="22" r="12" fill="#e9a08a" opacity=".3" />
      <Peach at="translate(40 38)" r={0.7} />
      <Peach at="translate(64 26)" r={0.7} />
      <Peach at="translate(88 36)" r={0.7} />
      <path d="M8 76V54h22v22M6 54h26l-3-5H9Z" stroke={INK} strokeWidth="1.6" fill="none" opacity=".55" />
    </>
  ),
  harvest: (
    <>
      <Hills />
      <Sun x={96} y={20} r={8} />
      {[26, 38, 50].map((x) => (
        <g key={x} transform={`translate(${x} 70)`}>
          <path d="M0 0c0-14 2-28 6-38M0 0c-2-14-6-26-12-34M0 0c1-14 0-26-2-36" stroke={GOLD} strokeWidth="1.6" fill="none" />
          <path d="M6-38c2 4 1 8-2 10M-12-34c0 4 2 7 5 8M-2-36c2 4 1 8-1 9" stroke={GOLD} strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      ))}
      <path d="M64 76c-2-10 0-18 4-22h32c4 4 6 12 4 22Z" fill={INK} opacity=".75" />
      <path d="M66 62h40M66 68h40" stroke={PAPER} strokeWidth=".8" opacity=".4" />
      <Peach at="translate(76 50)" r={0.6} />
      <circle cx="90" cy="50" r="5" fill={RED} opacity=".8" />
      <circle cx="98" cy="52" r="4" fill={JADE} />
    </>
  ),
  borrowed_sword: (
    <>
      <Hills />
      <Mist y={56} />
      <Jian at="translate(60 66) rotate(-90)" len={58} />
      <path d="M22 52c10-14 24-18 38-16 14 2 26 0 38-12" stroke={RED} strokeWidth="1.8" fill="none" strokeDasharray="4 3" />
      <path d="M94 22l6 0-2 6" stroke={RED} strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22" cy="52" r="4" fill="none" stroke={INK} strokeWidth="1.6" />
    </>
  ),
  nullify: (
    <>
      <Hills />
      <circle cx="56" cy="40" r="24" fill="none" stroke={INK} strokeWidth="6" strokeDasharray="130 25" strokeLinecap="round" opacity=".7" transform="rotate(-60 56 40)" />
      <path d="M110 18 86 30" stroke={INK} strokeWidth="1.4" />
      <path d="M86 30l6-1-2 5Z" fill={INK} />
      <path d="M84 34l-6 10M80 30l-10 2" stroke={RED} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M78 46l10 8" stroke={INK} strokeWidth="1.4" opacity=".6" />
    </>
  ),
  indulgence: (
    <>
      <circle cx="88" cy="20" r="11" fill={PAPER} stroke={INK} strokeWidth="1" opacity=".9" />
      <Hills far={0.06} near={0.1} />
      <path d="M20 70V40M60 70V40M14 40h52l-8-10H22Z" stroke={INK} strokeWidth="2" fill="none" strokeLinejoin="round" opacity=".55" />
      <path d="M30 70c-2-8 0-14 6-16h8c6 2 8 8 6 16Z" fill={INK} opacity=".75" />
      <path d="M32 58h16" stroke={RED} strokeWidth="2" />
      <path d="M66 62h16l-3 8h-10Z" fill={RED} opacity=".85" />
      <path d="M74 70v6M68 76h12" stroke={INK} strokeWidth="1.6" />
      <path d="M72 54c2-4 6-4 6-8M78 56c2-3 5-3 5-6" stroke={INK} strokeWidth="1.2" fill="none" opacity=".4" />
    </>
  ),
  lightning: (
    <>
      <path d="M10 30c0-10 14-14 20-6 4-12 22-14 28-2 6-8 22-6 22 4 10-2 16 10 6 14H18c-8 0-12-6-8-10Z" fill={INK} opacity=".7" />
      <path d="M58 36 46 58h10l-6 20 22-30H60l8-12Z" fill="#f0c45a" stroke={INK} strokeWidth="1" />
      <path d="M90 50l-4 6M100 46l-4 7M30 52l-4 6M20 48l-4 6" stroke={INK} strokeWidth="1.2" opacity=".4" strokeLinecap="round" />
      <path d="M0 80c40-6 80-6 120 0" stroke={INK} strokeWidth="1.2" opacity=".3" fill="none" />
    </>
  ),

  // -- weapons
  crossbow: (
    <>
      <Hills />
      <g transform="translate(58 46) rotate(-18)">
        <path d="M-30 0H30" stroke={INK} strokeWidth="5" strokeLinecap="round" />
        <path d="M18-22c8 8 8 36 0 44" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M18-22L-6 0l24 22" stroke={INK} strokeWidth=".9" fill="none" />
        <rect x="-8" y="-9" width="18" height="8" rx="1.5" fill={GOLD} />
        <path d="M-28 4l-4 10h6l2-10" fill={INK} />
        {[0, 4, 8].map((d) => (
          <path key={d} d={`M${-2 + d}-11h24`} stroke={RED} strokeWidth="1.2" />
        ))}
      </g>
    </>
  ),
  piercing_sword: (
    <>
      <Hills />
      <Sun x={88} y={24} r={8} />
      <path d="M60 8v60" stroke="#f3e4b8" strokeWidth="10" opacity=".5" strokeLinecap="round" />
      <Jian at="translate(60 66)" len={60} />
    </>
  ),
  twin_swords: (
    <>
      <Hills />
      <Mist y={60} />
      <Jian at="translate(44 70) rotate(28)" len={60} />
      <Jian at="translate(76 70) rotate(-28)" len={60} />
    </>
  ),
  frost_blade: (
    <>
      <path d="M0 0h120v84H0Z" fill="#9fc3d6" opacity=".18" />
      <Hills />
      <Jian at="translate(60 70) rotate(-20)" len={62} edge="#3b5f7a" />
      {[
        [26, 22],
        [94, 18],
        [86, 52],
        [30, 56],
        [104, 36],
      ].map(([x, y]) => (
        <path
          key={`${x}${y}`}
          d={`M${x - 5} ${y}h10M${x} ${y - 5}v10M${x - 3.5} ${y - 3.5}l7 7M${x + 3.5} ${y - 3.5}l-7 7`}
          stroke="#3b5f7a"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity=".7"
        />
      ))}
    </>
  ),
  dragon_glaive: (
    <>
      <Hills />
      <Cloud at="translate(70 24)" o={0.45} />
      <Cloud at="translate(16 40) scale(.8)" o={0.35} />
      <Pole
        at="translate(44 80) rotate(18)"
        len={66}
        head={<path d="M-2 4C-4-8 2-18 14-22 8-14 10-6 4 2c4 0 6 2 6 4H-2Z" fill={INK} />}
      />
      <path d="M48 30c6-6 14-6 18 0" stroke={JADE} strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  ),
  stone_axe: (
    <>
      <Hills />
      <path d="M8 80c6-14 22-20 40-20 18 0 28 8 34 20Z" fill={INK} opacity=".35" />
      <Pole
        at="translate(56 74) rotate(-24)"
        len={56}
        head={<path d="M0 6C10 4 20 0 22-10 24-22 14-30 4-26 2-20 2-14 0-10Z" fill={INK} />}
      />
      <path d="M78 18l4 6M84 28l5 2" stroke={RED} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  serpent_spear: (
    <>
      <Hills />
      <Mist />
      <Pole
        at="translate(40 80) rotate(30)"
        len={66}
        head={<path d="M0 4c-3-4 3-6 0-10s3-6 0-10 2-6 0-10l2-6 2 6c-2 4 3 6 0 10s3 6 0 10 3 6 0 10Z" fill={INK} />}
      />
      <path d="M68 16c4-2 8 0 8 4" stroke={RED} strokeWidth="1.6" fill="none" />
    </>
  ),
  halberd: (
    <>
      <Hills />
      <Sun x={30} y={22} r={8} />
      <Pole
        at="translate(66 80) rotate(-10)"
        len={68}
        head={
          <>
            <path d="M-2 10l2-16 2 16Z" fill={INK} />
            <path d="M2 14c8-2 14 2 16 8-6-2-10-2-16 0ZM-2 14c-8-2-14 2-16 8 6-2 10-2 16 0Z" fill={INK} />
          </>
        }
      />
    </>
  ),
  kirin_bow: (
    <>
      <Hills />
      <Cloud at="translate(76 58) scale(1.1)" o={0.35} />
      <path d="M40 10c22 10 22 54 0 64" stroke={INK} strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <path d="M40 10 26 42 40 74" stroke={INK} strokeWidth=".9" fill="none" />
      <Arrow at="translate(104 42)" len={78} />
      <path d="M40 10l-4-3M40 74l-4 3" stroke={RED} strokeWidth="2" strokeLinecap="round" />
    </>
  ),

  // -- armor and horses
  eight_trigrams: (
    <>
      <Hills far={0.05} near={0.08} />
      <path d="M60 10 82 19 91 41 82 63 60 72 38 63 29 41 38 19Z" fill="none" stroke={INK} strokeWidth="2" opacity=".7" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => (
        <g key={a} transform={`rotate(${a} 60 41)`}>
          <path d={i % 2 ? "M54 16h12M54 20h4M62 20h4M54 24h12" : "M54 16h12M54 20h12M54 24h4M62 24h4"} stroke={INK} strokeWidth="1.6" />
        </g>
      ))}
      <circle cx="60" cy="41" r="11" fill={PAPER} stroke={INK} strokeWidth="1" />
      <path d="M60 30a5.5 5.5 0 0 1 0 11 5.5 5.5 0 0 0 0 11 11 11 0 0 1 0-22Z" fill={INK} />
      <circle cx="60" cy="35.5" r="1.6" fill={PAPER} />
      <circle cx="60" cy="46.5" r="1.6" fill={INK} />
    </>
  ),
  benevolent_shield: (
    <>
      <Hills />
      <circle cx="60" cy="42" r="28" fill={INK} opacity=".82" />
      <circle cx="60" cy="42" r="22" fill="none" stroke={GOLD} strokeWidth="1.6" />
      <path d="M60 28c4 6 4 12 0 18-4-6-4-12 0-18ZM60 46c-6-2-12 0-14 4 6 2 10 0 14-4ZM60 46c6-2 12 0 14 4-6 2-10 0-14-4Z" fill={RED} />
      <circle cx="60" cy="42" r="3" fill={GOLD} />
    </>
  ),
  plus_horse: (
    <>
      <Hills />
      <Sun x={96} y={20} r={7} />
      <Horse at="translate(26 18) scale(1.2)" />
      <path d="M18 70h84" stroke={INK} strokeWidth="1.2" opacity=".35" />
    </>
  ),
  minus_horse: (
    <>
      <Hills />
      <Horse at="translate(32 18) scale(1.2)" gallop />
      <path d="M8 34h16M4 42h18M10 50h14" stroke={INK} strokeWidth="1.6" strokeLinecap="round" opacity=".4" />
      <path d="M30 72c20-2 50-2 80 0" stroke={INK} strokeWidth="1.2" opacity=".35" fill="none" />
    </>
  ),
};

/** Is there a built-in scene for this card? */
export const hasScene = (name: string): boolean => name in SCENES;

/** The card's built-in illustration, filling its box (cropped to fit, centred). */
export function CardArt({ name }: { name: string }) {
  const scene = SCENES[name];
  if (!scene) return null;
  return (
    <svg className="card-art" viewBox="0 0 120 84" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {scene}
    </svg>
  );
}
