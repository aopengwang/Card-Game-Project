// Motion timings for JS-driven animations. Keep in sync with the --ik-dur-* / --ik-ease-*
// tokens in tokens.css (tokens.test.ts checks they match).

export const DURATION = {
  fast: 150,
  card: 320,
  line: 250,
  hit: 400,
  stamp: 250,
  banner: 600,
} as const;

export const EASE = {
  out: [0.2, 0.8, 0.2, 1],
  stamp: [0.3, 1.6, 0.5, 1],
} as const;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
