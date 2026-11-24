import { useSyncExternalStore } from "react";

/*
 * Which card / hero images exist (from the server's /api/art, which scans
 * client/public/art). Only listed images are requested; everything else uses the built-in
 * ink illustrations, so there are no 404s and a dropped-in image appears on refresh.
 */
export type ArtKind = "cards" | "heroes";
type Manifest = Record<ArtKind, Record<string, string>>;

let manifest: Manifest = { cards: {}, heroes: {} };
const listeners = new Set<() => void>();

export async function loadArt(): Promise<void> {
  try {
    const r = await fetch("/api/art");
    if (!r.ok) return;
    const m = (await r.json()) as Partial<Manifest>;
    manifest = { cards: m.cards ?? {}, heroes: m.heroes ?? {} };
    listeners.forEach((l) => l());
  } catch {
    // no server (unit tests, offline): built-in art only
  }
}

export const artUrl = (kind: ArtKind, id: string): string | undefined => manifest[kind][id];

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The image url for this card/hero, or undefined; re-renders when the manifest loads. */
export function useArtUrl(kind: ArtKind, id: string): string | undefined {
  return useSyncExternalStore(subscribe, () => manifest[kind][id]);
}

/** The whole manifest (for the art gallery). */
export function useArtManifest(): Manifest {
  return useSyncExternalStore(subscribe, () => manifest);
}
