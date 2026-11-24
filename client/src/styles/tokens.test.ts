import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DURATION } from "./motion";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

function token(name: string): string {
  const m = rootBlock.match(new RegExp(`--ik-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`missing token --ik-${name}`);
  return m[1].trim();
}

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("Ink & Lacquer tokens", () => {
  // [text token, background token, minimum ratio] for every pairing the design uses.
  const pairs: [string, string, number][] = [
    ["text", "lacquer", 4.5],
    ["text", "panel", 4.5],
    ["text-strong", "panel-raised", 4.5],
    ["text-muted", "lacquer", 4.5],
    ["text-muted", "panel", 4.5],
    ["text-faint", "lacquer", 4.5],
    ["text-faint", "panel", 4.5],
    ["gold", "lacquer", 4.5],
    ["gold", "panel", 4.5],
    ["danger-text", "panel", 4.5],
    ["ink", "paper", 7],
    ["ink", "paper-shade", 7],
    ["ink-soft", "paper", 4.5],
    ["ink-muted", "paper", 4.5],
    ["on-vermilion", "vermilion", 4.5],
    ["on-vermilion", "role-loyalist", 4.5],
    ["text", "role-rebel", 4.5],
    ["text", "role-spy", 4.5],
  ];

  it.each(pairs)("%s on %s has enough contrast", (fg, bg, min) => {
    const ratio = contrast(token(fg), token(bg));
    expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  });

  it("kingdom colors are distinguishable by lightness, not hue alone", () => {
    const ls = ["wei", "shu", "wu", "qun"].map((k) => luminance(token(k)));
    expect(new Set(ls.map((l) => l.toFixed(2))).size).toBe(4);
  });

  it("JS motion timings match the CSS tokens", () => {
    for (const [name, ms] of Object.entries(DURATION)) {
      expect(token(`dur-${name}`)).toBe(`${ms}ms`);
    }
  });
});
