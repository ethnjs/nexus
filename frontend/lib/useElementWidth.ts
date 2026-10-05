import { useCallback, useRef, useState } from "react";

/**
 * An element's current width, kept live with a ResizeObserver — for layout
 * that has to react to the space it actually gets (a docked panel or a narrow
 * window), not to the viewport. Pass the returned ref callback as `ref`.
 * 0 until the element mounts.
 */
export function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(el);
  }, []);
  return [ref, width];
}
