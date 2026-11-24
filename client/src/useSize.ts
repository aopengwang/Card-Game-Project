import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/** The window's inner size, updated on resize. */
export function useWindowSize() {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize((s) => {
      const n = read();
      return s.width === n.width && s.height === n.height ? s : n;
    });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/**
 * An element's inner size (clientWidth/Height), kept current with a ResizeObserver;
 * 0x0 until measured. Returns a callback ref, so it works for elements that mount later.
 */
export function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useCallback((node: T | null) => setEl(node), []);
  useLayoutEffect(() => {
    if (!el) return;
    const read = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, size] as const;
}
