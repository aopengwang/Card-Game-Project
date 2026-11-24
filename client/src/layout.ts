/**
 * Where opponents sit around the table. You are at the bottom (in the dock). Turn order
 * runs counter-clockwise from your point of view: the next player sits on your right,
 * the one before you on your left.
 */
export function opponentOrder(you: number, n: number): number[] {
  return Array.from({ length: n - 1 }, (_, i) => (you + 1 + i) % n);
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TableLayout {
  /** One box per opponent, in opponentOrder (index 0 = the player on your right). */
  seats: Box[];
  /** The battlefield: draw/discard piles and the latest plays. */
  center: Box;
  /** Height of every opponent plaque (they never grow with content). */
  plaqueHeight: number;
}

/** Fixed sizes the layout is built from; the CSS reads them back as custom properties. */
export const LAYOUT = {
  pad: 10, // table edge to seats
  gap: 12, // between a seat and the battlefield
  plaqueTall: 184,
  plaqueShort: 168, // short windows (laptops with toolbars)
  shortBelow: 400, // table heights under this use the short plaque
  plaqueMinW: 128,
  plaqueMaxW: 176,
  centerH: 126,
  centerMaxW: 600,
  centerMinW: 300,
} as const;

export interface SizeTier {
  name: "compact" | "roomy" | "large";
  /** hand card size */
  handW: number;
  handH: number;
  /** dock height: prompt bar (108) + hand row (card + 20 for the lift) + padding */
  dockH: number;
  /** battlefield height and the size of the cards played on it */
  centerH: number;
  playSize: "sm" | "md";
  playW: number;
}

const TIERS: SizeTier[] = [
  { name: "compact", handW: 88, handH: 124, dockH: 280, centerH: 126, playSize: "sm", playW: 64 },
  { name: "roomy", handW: 110, handH: 154, dockH: 310, centerH: 160, playSize: "md", playW: 88 },
  { name: "large", handW: 126, handH: 176, dockH: 332, centerH: 160, playSize: "md", playW: 88 },
];

/**
 * Card sizes for a window. Picked from the window size alone (never from what's on the
 * table), so they only change when you resize the window, not while you play. Phones
 * (<= 760 wide) keep the compact size; their page scrolls instead.
 */
export function sizeTier(windowW: number, windowH: number): SizeTier {
  if (windowW <= 760 || windowH < 820) return TIERS[0];
  return windowH < 1000 ? TIERS[1] : TIERS[2];
}

/**
 * Lay the table out in pixels for an arena of `w` x `h`. Pure and size-only: what's on
 * the plaques never moves anything. Seats spread in one row (none overlap), the middle
 * ones level at the top and the outer ones curving down the sides like a table edge;
 * the battlefield sits under the middle seats, as wide as the curved seats allow.
 */
export function tableLayout(count: number, w: number, h: number, centerH: number = LAYOUT.centerH): TableLayout | null {
  const L = LAYOUT;
  const plaqueHeight = h < L.shortBelow ? L.plaqueShort : L.plaqueTall;
  // Too narrow or short for one row of seats over the battlefield: the caller stacks them.
  if (count * L.plaqueMinW + (count + 1) * L.pad > w) return null;
  if (L.pad + plaqueHeight + L.gap + centerH > h) return null;
  const pw = Math.max(L.plaqueMinW, Math.min(L.plaqueMaxW, (w - L.pad * (count + 1)) / Math.max(count, 1)));

  // How far the outermost seats may drop: down to the bottom of the table.
  const drop = Math.max(0, Math.min(h - plaqueHeight - 2 * L.pad, 260));
  const seats: Box[] = [];
  for (let i = 0; i < count; i++) {
    // u: 1 (far right) .. -1 (far left); a lone opponent sits in the middle, two sit apart.
    const u = count === 1 ? 0 : count === 2 ? (i === 0 ? 0.6 : -0.6) : 1 - (2 * i) / (count - 1);
    const x = w / 2 + u * (w / 2 - L.pad - pw / 2);
    const bend = Math.max(0, (Math.abs(u) - 0.5) / 0.5); // the inner half stays level
    seats.push({ left: Math.round(x - pw / 2), top: Math.round(L.pad + drop * bend * bend), width: Math.round(pw), height: plaqueHeight });
  }

  // Battlefield: centred in the space under the level seats, as wide as the seats that
  // curve down beside it allow; if that's too narrow, tucked up right under the top row.
  const highest = L.pad + plaqueHeight + L.gap;
  const widthAt = (top: number) => {
    let half = L.centerMaxW / 2;
    for (const s of seats) {
      const overlapsV = s.top + s.height + L.gap > top && s.top < top + centerH + L.gap;
      if (!overlapsV) continue;
      const dist = s.left + s.width / 2 < w / 2 ? w / 2 - (s.left + s.width) : s.left - w / 2;
      half = Math.min(half, dist - L.gap);
    }
    return Math.floor(half * 2);
  };
  let top = Math.max(highest, Math.round((highest + h - L.pad - centerH) / 2));
  if (widthAt(top) < L.centerMinW) top = highest;
  const cw = Math.max(L.centerMinW, widthAt(top));
  return { seats, center: { left: Math.round(w / 2 - cw / 2), top, width: cw, height: centerH }, plaqueHeight };
}

/** True if two boxes overlap (touching edges don't count). For tests. */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * Fanned hand: how far apart cards sit (px between left edges) and each card's tilt.
 * Cards overlap when the hand is wide but always show at least half of themselves, so
 * every card stays clickable; past that the hand scrolls sideways.
 */
export function handFan(n: number, width: number, cardW = 88): { step: number; tilt: (i: number) => number } {
  const natural = cardW + 8;
  // Minimum step: over half a card, plus slack for the tilt, so each card's middle shows.
  const room = width - 16; // the hand's side padding
  const step = n <= 1 ? natural : Math.max(Math.ceil(cardW / 2) + 8, Math.min(natural, (room - cardW) / (n - 1)));
  const spread = Math.min(1.5, 10 / Math.max(n, 1)); // degrees per card from the middle
  const tilt = (i: number) => {
    const deg = (i - (n - 1) / 2) * spread;
    return (Math.sign(deg) * Math.round(Math.abs(deg) * 10)) / 10 || 0; // symmetric, no -0
  };
  return { step: Math.floor(step), tilt };
}
