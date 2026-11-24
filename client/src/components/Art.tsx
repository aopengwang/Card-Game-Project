import { useState, type ReactNode } from "react";
import { useArtUrl, type ArtKind } from "../art";

/**
 * An image slot: the card/hero image from client/public/art when one exists (see art.ts),
 * otherwise the fallback (the built-in ink illustration). Missing images are never
 * requested; a listed image that fails to load also falls back.
 */
export function Art({ kind, id, fallback, className }: { kind: ArtKind; id: string; fallback: ReactNode; className?: string }) {
  const url = useArtUrl(kind, id);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return fallback == null ? null : <div className={`art-fallback ${className ?? ""}`}>{fallback}</div>;
  return <img className={`art ${className ?? ""}`} src={url} alt="" draggable={false} onError={() => setFailed(url)} />;
}
