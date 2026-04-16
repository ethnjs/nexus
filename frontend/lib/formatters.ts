// ─── Time / date formatters ───────────────────────────────────────────────────

/** "HH:MM" (24hr) → "9:00 AM" / "12:30 PM" */
export function fmtTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${period}`;
}

/** "YYYY-MM-DD" → "Wed, Mar 15" */
export function fmtDate(yyyymmdd: string): string {
  const [yr, mo, d] = yyyymmdd.split("-").map(Number);
  return new Date(yr, mo - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "YYYY-MM-DD" → "Mar 15" */
export function fmtDateShort(yyyymmdd: string): string {
  const [yr, mo, d] = yyyymmdd.split("-").map(Number);
  return new Date(yr, mo - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ─── Category color helpers ───────────────────────────────────────────────────

/** Returns the CSS var slot (1–5) for a category given its 0-based list index. */
export function catColorIndex(idx: number): number {
  return (idx % 5) + 1;
}

/** Returns the three CSS variable names for a category color slot. */
export function catColorVars(idx: number): {
  main:   string;
  subtle: string;
  text:   string;
} {
  const slot = catColorIndex(idx);
  return {
    main:   `var(--color-cat-${slot})`,
    subtle: `var(--color-cat-${slot}-subtle)`,
    text:   `var(--color-cat-${slot}-text)`,
  };
}
