import { useCallback, useRef, useState } from "react";

/**
 * Whether an element is narrower than `px`, kept live with a ResizeObserver —
 * for layout that has to react to the space it actually gets (a docked panel
 * or a narrow window), not to the viewport. Pass the returned ref callback as
 * `ref`. False until the element mounts (or while it measures 0).
 *
 * A boolean rather than the width on purpose: a docked panel sliding open
 * resizes the element every frame, and a pixel width in state re-rendered the
 * caller on each one. Setting the same boolean bails out, so only a crossing
 * re-renders.
 */
export function useElementNarrowerThan<T extends HTMLElement>(px: number): [(el: T | null) => void, boolean] {
  const [narrow, setNarrow] = useState(false);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setNarrow(width > 0 && width < px);
    });
    observer.current.observe(el);
  }, [px]);
  return [ref, narrow];
}
