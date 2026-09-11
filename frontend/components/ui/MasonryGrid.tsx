"use client";

import { ReactNode, useLayoutEffect, useRef } from "react";

interface MasonryGridProps {
  children: ReactNode;
  /** Narrowest a column may get before the grid drops to fewer columns. */
  minColumnWidth?: number;
  gap?: number;
}

/**
 * A gapless mosaic: each card only as tall as its content, dropped into the
 * earliest hole it fits. A child too wide for one column sets
 * `data-min-width` and spans as many columns as that takes.
 *
 * Rows are 1px and each child spans its own height in rows; `dense` lets a
 * later card backfill a hole an earlier, wider one left.
 */
export function MasonryGrid({ children, minColumnWidth = 340, gap = 16 }: MasonryGridProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;

    const spanColumns = (node: HTMLElement) => {
      const minWidth = Number(node.dataset.minWidth);
      if (!minWidth) return;
      // Resolved track sizes, e.g. "352px 352px 352px".
      const columns = getComputedStyle(grid).gridTemplateColumns.split(" ");
      const columnWidth = parseFloat(columns[0]);
      node.style.gridColumn = `span ${Math.min(columns.length, Math.ceil((minWidth + gap) / (columnWidth + gap)))}`;
    };

    // Span is set before measuring: width decides how tall the content wraps.
    const fit = (el: Element) => {
      const node = el as HTMLElement;
      spanColumns(node);
      // Trailing rows past the card's height are the vertical gap.
      node.style.gridRowEnd = `span ${Math.ceil(node.getBoundingClientRect().height) + gap}`;
    };
    const fitAll = () => Array.from(grid.children).forEach(fit);

    // The grid itself is watched too: a column count change re-spans the wide
    // children even when nothing inside them resized.
    const resize = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.target === grid)) fitAll();
      else entries.forEach((entry) => fit(entry.target));
    });

    // DOM children, not React children: a component rendering several cards
    // (or none, until its fetch lands) still lays out card by card.
    const observeAll = () => {
      resize.disconnect();
      resize.observe(grid);
      for (const child of Array.from(grid.children)) resize.observe(child);
      fitAll();
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
        gridAutoFlow: "row dense",
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
