"use client";

import { ReactNode, useLayoutEffect, useRef } from "react";

interface MasonryGridProps {
  children: ReactNode;
  /** Narrowest a column may get before the grid drops to fewer columns. */
  minColumnWidth?: number;
  gap?: number;
}

/**
 * Cards in columns, each only as tall as its content, placed in source order.
 *
 * Rows are 1px and each child spans its own height in rows, so grid's
 * auto-placement drops every card into the leftmost column that frees up
 * first. CSS columns would fill top-to-bottom instead, breaking the order.
 */
export function MasonryGrid({ children, minColumnWidth = 340, gap = 16 }: MasonryGridProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;

    // Trailing rows past the card's height are the vertical gap.
    const fit = (el: Element) => {
      (el as HTMLElement).style.gridRowEnd = `span ${Math.ceil(el.getBoundingClientRect().height) + gap}`;
    };
    const resize = new ResizeObserver((entries) => entries.forEach((entry) => fit(entry.target)));

    // DOM children, not React children: a component rendering several cards
    // (or none, until its fetch lands) still lays out card by card.
    const observeAll = () => {
      resize.disconnect();
      for (const child of Array.from(grid.children)) {
        fit(child);
        resize.observe(child);
      }
    };
    observeAll();
    const mutations = new MutationObserver(observeAll);
    mutations.observe(grid, { childList: true });

    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [gap]);

  return (
    <div
      ref={ref}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minColumnWidth}px), 1fr))`,
        gridAutoRows: "1px",
        columnGap: `${gap}px`,
        // Cards keep their content height instead of stretching to their span,
        // which is what makes the measurement stable.
        alignItems: "start",
      }}
    >
      {children}
    </div>
  );
}
