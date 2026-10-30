import type { ChangeEvent } from "react";
import type { ChevronProps, DayPickerProps, DropdownProps, Matcher } from "react-day-picker";
import { Dropdown } from "@/components/ui/Dropdown";
import { IconChevronLeft, IconChevronRight } from "@/components/ui/Icons";
import { parseLocalDate } from "@/lib/date";
import styles from "./Calendar.module.css";

function Chevron({ orientation }: ChevronProps) {
  return orientation === "left" ? <IconChevronLeft size={14} /> : <IconChevronRight size={14} />;
}

/** The month and year captions, as the kit's Dropdown rather than a native select. */
function CalendarDropdown({ options = [], value, onChange }: DropdownProps) {
  return (
    <Dropdown
      size="sm"
      variant="transparent"
      fitContent
      value={String(value)}
      options={options.map((o) => ({
        value: String(o.value),
        label: o.label,
        disabled: o.disabled,
      }))}
      // DayPicker only reads target.value off the select's change event.
      onChange={(v) => onChange?.({ target: { value: v } } as ChangeEvent<HTMLSelectElement>)}
    />
  );
}

const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: "short" });

/** The DayPicker props DatePicker and DateRangePicker share, for the app's look. */
export const CALENDAR_PROPS = {
  showOutsideDays: true,
  classNames: {
    root: styles.root,
    months: styles.months,
    nav: styles.nav,
    button_previous: styles.navButton,
    button_next: styles.navButton,
    month_caption: styles.monthCaption,
    caption_label: styles.captionLabel,
    dropdowns: styles.dropdowns,
    month_grid: styles.monthGrid,
    weekday: styles.weekday,
    day: styles.day,
    day_button: styles.dayButton,
    disabled: styles.disabled,
    outside: styles.outside,
    today: styles.today,
    range_start: styles.rangeStart,
    range_middle: styles.rangeMiddle,
    range_end: styles.rangeEnd,
  },
  components: { Chevron, Dropdown: CalendarDropdown },
  formatters: {
    // "Su", "Mo": the short weekday's first two letters.
    formatWeekdayName: (date: Date) => weekdayName.format(date).slice(0, 2),
  },
} satisfies Partial<DayPickerProps>;

/** The field's date format: "Feb 13, 2027". */
export const fieldDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  year: "numeric",
});

/** Days outside "YYYY-MM-DD" bounds, for DayPicker's `disabled`. */
export function outOfBounds(min?: string, max?: string): Matcher[] {
  const matchers: Matcher[] = [];
  if (min) matchers.push({ before: parseLocalDate(min) });
  if (max) matchers.push({ after: parseLocalDate(max) });
  return matchers;
}
