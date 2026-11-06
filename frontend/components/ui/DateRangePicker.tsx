"use client";

import { useState } from "react";
import { type DateRange, DayPicker } from "react-day-picker";
import { CALENDAR_PROPS, fieldDate, outOfBounds } from "@/components/ui/Calendar";
import { IconCalendar } from "@/components/ui/Icons";
import { PickerField, type PickerFieldCommonProps } from "@/components/ui/PickerField";
import { parseLocalDate, todayLocalDateString, toLocalDateString } from "@/lib/date";
import { useIsMobile } from "@/lib/useIsMobile";
import styles from "./Calendar.module.css";

/** One quick pick down the panel's side. `range` runs when it's clicked, so
 *  "next 30 days" is counted from the day it's used. */
export interface DateRangeShortcut {
  label: string;
  range: () => [from: string, to: string];
}

interface DateRangePickerProps extends PickerFieldCommonProps {
  /** "YYYY-MM-DD", or "" for an unset end. */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Lets either end stay empty, for a filter. Otherwise a pick is always a
   *  whole range, one day long until a second click extends it. */
  openEnds?: boolean;
  /** "YYYY-MM-DD" bounds; days outside them can't be picked. */
  min?: string;
  max?: string;
  placeholder?: string;
  shortcuts?: DateRangeShortcut[];
}

/** "Feb 13, 2027 – Mar 01, 2027", one day, or one open end. */
function formatRange(from: string, to: string): string | null {
  if (!from && !to) return null;
  if (!to) return `From ${fieldDate.format(parseLocalDate(from))}`;
  if (!from) return `Until ${fieldDate.format(parseLocalDate(to))}`;
  if (from === to) return fieldDate.format(parseLocalDate(from));
  return `${fieldDate.format(parseLocalDate(from))} – ${fieldDate.format(parseLocalDate(to))}`;
}

/**
 * A field that opens a calendar (react-day-picker) for picking a range of
 * days: the first click sets the start, the second the end, previewed under
 * the pointer in between. Values are ISO dates.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  openEnds = false,
  min,
  max,
  placeholder = "Any dates",
  shortcuts = [],
  ...fieldProps
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseLocalDate(from || todayLocalDateString()));
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  // The start clicked in this opening, while the next click would end it.
  const [anchor, setAnchor] = useState<string | null>(null);
  // With open ends, a stored start with no end is itself mid-pick.
  const start = openEnds ? from : anchor;
  const picking = !!start && (!openEnds || !to);

  function setOpenState(next: boolean) {
    if (next) {
      setMonth(parseLocalDate(from || to || todayLocalDateString()));
      setHoverDay(null);
      setAnchor(null);
    }
    setOpen(next);
  }

  // By the clicked day rather than the range DayPicker proposes, which treats
  // one click as a whole one-day range: here the first click is only a start.
  function pick(date: Date) {
    const day = toLocalDateString(date);
    if (picking && start && day >= start) {
      onChange(start, day);
      setOpenState(false);
    } else if (openEnds) {
      // A fresh range, or a day before the start, which begins it again there.
      onChange(day, "");
    } else {
      onChange(day, day);
      setAnchor(day);
    }
  }

  // What the calendar draws: the range so far, or while picking, from the
  // start to the day under the pointer. A lone end is a one-day range, so it
  // shows as a single square rather than half a band.
  const shownStart = picking ? start : from || to;
  const shownEnd = picking && start ? (hoverDay && hoverDay >= start ? hoverDay : start) : to;
  const selected: DateRange | undefined = shownStart
    ? { from: parseLocalDate(shownStart), to: parseLocalDate(shownEnd || shownStart) }
    : undefined;

  return (
    <PickerField
      {...fieldProps}
      icon={<IconCalendar size={14} />}
      display={formatRange(from, to)}
      placeholder={placeholder}
      onClear={fieldProps.required ? undefined : () => onChange("", "")}
      open={open}
      onOpenChange={setOpenState}
      panelLabel={fieldProps["aria-label"] ?? fieldProps.label ?? "Pick dates"}
      panelStyle={{ display: "flex", flexDirection: isMobile ? "column" : "row" }}
      panel={
        <>
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
                    setOpenState(false);
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

          {/* Off the calendar rather than off each day, so moving between days
              doesn't drop the preview for a frame. */}
          <div onMouseLeave={() => setHoverDay(null)}>
            <DayPicker
              {...CALENDAR_PROPS}
              mode="range"
              selected={selected}
              onSelect={(_range, triggerDate) => pick(triggerDate)}
              onDayMouseEnter={(date) => setHoverDay(toLocalDateString(date))}
              month={month}
              onMonthChange={setMonth}
              numberOfMonths={isMobile ? 1 : 2}
              autoFocus
              disabled={outOfBounds(min, max)}
            />
          </div>
        </>
      }
    />
  );
}
