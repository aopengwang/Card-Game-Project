/**
 * Where opponents sit around the table, as percentages of the table area.
 * You are at the bottom. Turn order runs counter-clockwise from your point of view:
 * the next player sits on your right, the one before you on your left.
 */
export function opponentOrder(you: number, n: number): number[] {
  return Array.from({ length: n - 1 }, (_, i) => (you + 1 + i) % n);
}

/**
 * x: % of the table width (seat centre). y: 0-100, how far down the seat band the seat's
 * centre sits (0 = top of the table, 100 = bottom). The band is inset by half a plaque
 * (see seatTop), so a plaque never pokes out of the table whatever the window height.
 */
export function seatPositions(count: number): { x: number; y: number }[] {
  // Spread along the upper arc of an ellipse, from right (0°) over the top to left (180°).
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / (count + 1);
    const angle = Math.PI * (1 + (1 - t)); // 2π (right) → π (left), passing 1.5π (top)
    return {
      x: Math.round((50 + 42 * Math.cos(angle)) * 10) / 10,
      y: Math.round((1 + Math.sin(angle)) * 1000) / 10,
    };
  });
}

/** Half a seat plaque's height: the seat band starts and ends this far inside the table. */
export const SEAT_HALF_HEIGHT = 110;

/** CSS `top` for a seat centre at band position y (0-100). */
export function seatTop(y: number): string {
  return `calc(${SEAT_HALF_HEIGHT}px + (100% - ${2 * SEAT_HALF_HEIGHT}px) * ${y / 100})`;
}
