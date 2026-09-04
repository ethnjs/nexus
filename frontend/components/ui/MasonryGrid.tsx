"use client";

import { Children, ReactNode, useEffect, useRef, useState } from "react";

interface MasonryGridProps {
  children: ReactNode;
  /** Columns are as wide as they need to be to fit this many px. */
  minColumnWidth?: number;
  gap?: number;
}

/**
 * A masonry layout that keeps its children in reading order.
 *
 * Each item is as tall as its own content — a card listing four tracks is
 * legitimately taller than a single-day one, and a CSS grid would either
 * stretch every card to the tallest or leave a ragged bottom row.
 *
 * The obvious implementation is CSS multi-column, but that fills each column
 * top to bottom before starting the next, so items 1-2-3 stack down the left
 * instead of running across the top. Callers here render deliberately ordered
 * lists (newest first), so instead the items are dealt round-robin across the
 * columns: item n goes to column n % count, and left-to-right order survives.
 * The tradeoff is that column heights balance less evenly than CSS columns
 * manage — acceptable when the items are of broadly similar size.
 */
export function MasonryGrid({ children, minColumnWidth = 280, gap = 16 }: MasonryGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // n columns need n widths plus (n-1) gaps, so solving for n gives the
    // +gap on both sides of the division.
    function measure(width: number) {
      setColumnCount(Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap))));
    }

    measure(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [minColumnWidth, gap]);

  const items = Children.toArray(children);
  const columns: ReactNode[][] = Array.from({ length: columnCount }, () => []);
  items.forEach((item, i) => columns[i % columnCount].push(item));

  return (
    <div ref={containerRef} style={{ display: "flex", alignItems: "flex-start", gap: `${gap}px` }}>
      {columns.map((column, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: `${gap}px` }}>
          {column}
        </div>
      ))}
    </div>
  );
}
