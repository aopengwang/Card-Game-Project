import { useState } from "react";

/**
 * An image slot: shows /art/<kind>/<id>.png if it exists, otherwise the fallback.
 * Drop PNGs into client/public/art/cards/ and client/public/art/heroes/ to add art.
 */
export function Art({ kind, id, fallback, className }: { kind: "cards" | "heroes"; id: string; fallback: React.ReactNode; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback == null ? null : <div className={`art-fallback ${className ?? ""}`}>{fallback}</div>;
  return (
    <img
      className={`art ${className ?? ""}`}
      src={`/art/${kind}/${id}.png`}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
