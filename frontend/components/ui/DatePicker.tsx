"use client";

import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { CALENDAR_PROPS, fieldDate, outOfBounds } from "@/components/ui/Calendar";
import { IconCalendar } from "@/components/ui/Icons";
import { PickerField, type PickerFieldCommonProps } from "@/components/ui/PickerField";
import { parseLocalDate, todayLocalDateString, toLocalDateString } from "@/lib/date";
import styles from "./Calendar.module.css";

interface DatePickerProps extends PickerFieldCommonProps {
  /** "YYYY-MM-DD", or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  /** "YYYY-MM-DD" bounds; days outside them can't be picked, and the year
   *  dropdown stops at them. */
  min?: string;
  max?: string;
  placeholder?: string;
}

const YEARS_BACK = 100;
const YEARS_AHEAD = 10;

/**
 * A field that opens a one-month calendar (react-day-picker) for picking a
 * day, with month and year dropdowns for jumping far, as to a birthday.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Pick a date",
  ...fieldProps
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parseLocalDate(value || todayLocalDateString()));

  const thisYear = new Date().getFullYear();
  const startMonth = min ? parseLocalDate(min) : new Date(thisYear - YEARS_BACK, 0);
  const endMonth = max ? parseLocalDate(max) : new Date(thisYear + YEARS_AHEAD, 11);

  function setOpenState(next: boolean) {
    if (next) {
      const shown = parseLocalDate(value || todayLocalDateString());
      setMonth(shown > endMonth ? endMonth : shown < startMonth ? startMonth : shown);
    }
    setOpen(next);
  }

  return (
    <PickerField
      {...fieldProps}
      icon={<IconCalendar size={14} />}
      display={value ? fieldDate.format(parseLocalDate(value)) : null}
      placeholder={placeholder}
      onClear={fieldProps.required ? undefined : () => onChange("")}
      open={open}
      onOpenChange={setOpenState}
      panelLabel={fieldProps["aria-label"] ?? fieldProps.label ?? "Pick a date"}
      panel={
        <DayPicker
          {...CALENDAR_PROPS}
          // Only here: in range mode every day of the range is `selected`.
          classNames={{ ...CALENDAR_PROPS.classNames, selected: styles.selected }}
          mode="single"
          selected={value ? parseLocalDate(value) : undefined}
          onSelect={(_day, triggerDate) => {
            onChange(toLocalDateString(triggerDate));
            setOpenState(false);
          }}
          month={month}
          onMonthChange={setMonth}
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          autoFocus
          disabled={outOfBounds(min, max)}
        />
      }
    />
  );
}
