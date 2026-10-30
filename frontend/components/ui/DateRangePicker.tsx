"use client";

import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type ChevronProps, type DateRange, DayPicker } from "react-day-picker";
import { IconCalendar, IconChevronLeft, IconChevronRight, IconX } from "@/components/ui/Icons";
import { parseLocalDate, todayLocalDateString, toLocalDateString } from "@/lib/date";
import { useIsMobile } from "@/lib/useIsMobile";
import styles from "./DateRangePicker.module.css";

/** One quick pick down the panel's side. `range` runs when it's clicked, so
 *  "next 30 days" is counted from the day it's used. */
export interface DateRangeShortcut {
  label: string;
  range: () => [from: string, to: string];
}

interface DateRangePickerProps {
  /** "YYYY-MM-DD", or "" for an open end. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  shortcuts?: DateRangeShortcut[];
  "aria-label"?: string;
}

const PANEL_GAP = 4;
// Kept clear between the panel and the viewport edge.
const VIEWPORT_MARGIN = 8;
// Roughly the panel's height, for deciding whether it fits below the field.
const PANEL_HEIGHT = 340;

const fieldDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  year: "numeric",
});
const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** "Feb 13, 2027 – Mar 01, 2027", or one open end. */
function formatRange(from: string, to: string): string | null {
  if (!from && !to) return null;
  if (!to) return `From ${fieldDate.format(parseLocalDate(from))}`;
  if (!from) return `Until ${fieldDate.format(parseLocalDate(to))}`;
  return `${fieldDate.format(parseLocalDate(from))} – ${fieldDate.format(parseLocalDate(to))}`;
}

function Chevron({ orientation }: ChevronProps) {
  return orientation === "left" ? <IconChevronLeft size={14} /> : <IconChevronRight size={14} />;
}

const CLASS_NAMES = {
  root: styles.root,
  months: styles.months,
  nav: styles.nav,
  button_previous: styles.navButton,
  button_next: styles.navButton,
  month_caption: styles.monthCaption,
  caption_label: styles.captionLabel,
  month_grid: styles.monthGrid,
  weekday: styles.weekday,
  day: styles.day,
  day_button: styles.dayButton,
  outside: styles.outside,
  today: styles.today,
  range_start: styles.rangeStart,
  range_middle: styles.rangeMiddle,
  range_end: styles.rangeEnd,
};

type Pos = { left: number; maxHeight: number } & (
  | { top: number; bottom?: undefined }
  | { bottom: number; top?: undefined }
);

/**
 * A field that opens a calendar (react-day-picker) for picking a range of
 * days: the first click sets the start, the second the end, previewed under
 * the pointer in between. Either end may be left open. Values are ISO dates.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Any dates",
  shortcuts = [],
  "aria-label": ariaLabel,
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseLocalDate(from || todayLocalDateString()));
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Mid-pick: a start with no end yet, so the next click finishes the range.
  const picking = !!from && !to;

  function openPanel() {
    setMonth(parseLocalDate(from || to || todayLocalDateString()));
    setHoverDay(null);
    setOpen(true);
  }

  // Every way of closing goes through here, so the next opening is placed
  // afresh rather than flashing at the old spot.
  function close() {
    setOpen(false);
    setPos(null);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = fieldRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - PANEL_GAP;
      const above = r.top - PANEL_GAP;
      const flip = below < PANEL_HEIGHT && above > below;
      const maxHeight = Math.round((flip ? above : below) - VIEWPORT_MARGIN);
      const left = Math.round(r.left);
      setPos(
        flip
          ? { bottom: Math.round(window.innerHeight - r.top + PANEL_GAP), left, maxHeight }
          : { top: Math.round(r.bottom + PANEL_GAP), left, maxHeight },
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent) {
      const target = e.target as Node;
      if (fieldRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      // close(), spelled out: it's a fresh function each render, so naming
      // it here would re-attach this listener on every one.
      setOpen(false);
      setPos(null);
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [open]);

  // By the clicked day rather than the range DayPicker proposes, which treats
  // one click as a whole one-day range: here the first click is only a start.
  function pick(date: Date) {
    const day = toLocalDateString(date);
    if (picking && day >= from) {
      onChange(from, day);
      close();
    } else {
      // A fresh range, or a day before the start, which begins it again there.
      onChange(day, "");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape") return;
    // Kept from the filter modal around it, which would close on it too.
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  // What the calendar draws: the range so far, or while picking, from the
  // start to the day under the pointer. A lone end is a one-day range, so it
  // shows as a single square rather than half a band.
  const shownEnd = picking ? (hoverDay && hoverDay >= from ? hoverDay : from) : to;
  const shownStart = from || to;
  const selected: DateRange | undefined = shownStart
    ? { from: parseLocalDate(shownStart), to: parseLocalDate(shownEnd || shownStart) }
    : undefined;

  const label = formatRange(from, to);

  return (
    <div ref={fieldRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPanel())}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          height: "36px",
          padding: label ? "0 34px 0 10px" : "0 10px",
          fontFamily: "var(--font-sans)",
          fontSize: "14px",
          fontWeight: 500,
          textAlign: "left",
          color: label ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
          background: "var(--color-bg)",
          border: `1px solid ${open ? "var(--color-border-strong)" : "var(--color-border)"}`,
          borderRadius: "var(--radius-md)",
          cursor: "pointer",
          transition: "border-color 150ms ease",
        }}
      >
        <IconCalendar size={14} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label ?? placeholder}
        </span>
      </button>
      {label && (
        <button
          type="button"
          title="Clear dates"
          onClick={() => {
            onChange("", "");
            close();
          }}
          className="link-subtle"
          style={{
            position: "absolute",
            right: "10px",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
          }}
        >
          <IconX size={12} />
        </button>
      )}

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={ariaLabel ?? "Pick dates"}
          onKeyDown={handleKeyDown}
          // Off the calendar rather than off each day, so moving between days
          // doesn't drop the preview for a frame.
          onMouseLeave={() => setHoverDay(null)}
          className={`${styles.panel} ${pos.top === undefined ? styles.panelAbove : ""}`}
          style={{
            position: "fixed",
            left: pos.left,
            ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
            maxHeight: `${pos.maxHeight}px`,
            overflowY: "auto",
            zIndex: 9999,
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {shortcuts.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: isMobile ? "row" : "column",
                flexWrap: "wrap",
                gap: "2px",
                padding: "10px 8px",
                minWidth: isMobile ? undefined : "150px",
                ...(isMobile
                  ? { borderBottom: "1px solid var(--color-border)" }
                  : { borderRight: "1px solid var(--color-border)" }),
              }}
            >
              {shortcuts.map((shortcut) => (
                <button
                  key={shortcut.label}
                  type="button"
                  onClick={() => {
                    const [start, end] = shortcut.range();
                    onChange(start, end);
                    close();
                  }}
                  className={styles.shortcut}
                  style={{
                    padding: "6px 10px",
                    fontFamily: "var(--font-sans)",
                    fontSize: "13px",
                    textAlign: "left",
                    color: "var(--color-text-primary)",
                    borderRadius: "var(--radius-sm)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {shortcut.label}
                </button>
              ))}
            </div>
          )}

          <DayPicker
            mode="range"
            selected={selected}
            onSelect={(_range, triggerDate) => pick(triggerDate)}
            onDayMouseEnter={(date) => setHoverDay(toLocalDateString(date))}
            month={month}
            onMonthChange={setMonth}
            numberOfMonths={isMobile ? 1 : 2}
            showOutsideDays
            autoFocus
            classNames={CLASS_NAMES}
            components={{ Chevron }}
            formatters={{
              // "Su", "Mo": the short weekday's first two letters.
              formatWeekdayName: (date) => weekdayName.format(date).slice(0, 2),
            }}
          />
        </div>
      )}
    </div>
  );
}
