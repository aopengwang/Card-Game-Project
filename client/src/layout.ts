/**
 * Where opponents sit around the table, as percentages of the table area.
 * You are at the bottom. Turn order runs counter-clockwise from your point of view:
 * the next player sits on your right, the one before you on your left.
 */
export function opponentOrder(you: number, n: number): number[] {
  return Array.from({ length: n - 1 }, (_, i) => (you + 1 + i) % n);
}

export function seatPositions(count: number): { x: number; y: number }[] {
  // Spread along the upper arc of an ellipse, from right (0°) over the top to left (180°).
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / (count + 1);
    const angle = Math.PI * (1 + (1 - t)); // 2π (right) → π (left), passing 1.5π (top)
    return {
      x: Math.round((50 + 42 * Math.cos(angle)) * 10) / 10,
      y: Math.round((54 + 40 * Math.sin(angle)) * 10) / 10, // top seat ~14%: keeps tall seats on the felt
    };
  });
}
