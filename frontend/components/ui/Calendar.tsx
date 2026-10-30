import type { ChevronProps, DayPickerProps, Matcher } from "react-day-picker";
import { IconChevronDown, IconChevronLeft, IconChevronRight } from "@/components/ui/Icons";
import { parseLocalDate } from "@/lib/date";
import styles from "./Calendar.module.css";

function Chevron({ orientation }: ChevronProps) {
  if (orientation === "left") return <IconChevronLeft size={14} />;
  if (orientation === "down") return <IconChevronDown size={12} />;
  return <IconChevronRight size={14} />;
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
    dropdown_root: styles.dropdownRoot,
    dropdown: styles.dropdown,
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
  components: { Chevron },
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
