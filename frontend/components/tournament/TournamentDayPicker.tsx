"use client";

import { Dropdown } from "@/components/ui/Dropdown";
import { Input } from "@/components/ui/Input";
import { formatDayLabel } from "@/lib/timeFormat";

interface TournamentDayPickerProps {
  label?: string;
  value: string;
  onChange: (date: string) => void;
  /** The tournament's individual running days, ascending (YYYY-MM-DD).
      Empty while a caller is still fetching them separately from the rest
      of the page (e.g. the forms builder) — shown as a loading placeholder
      rather than an empty, pickable list. */
  days: string[];
  placeholder?: string;
  /** Extra caller-driven lock (e.g. a read-only event) layered on top of
      the single-day lock this component already applies on its own. */
  locked?: boolean;
  size?: "sm" | "md";
  fullWidth?: boolean;
  error?: string;
}

// Picks one of the tournament's actual running days — never an
// unconstrained date input, since "day" here always means one of the
// specific dates the tournament spans. A tournament with only one running
// day (or one whose dates haven't loaded yet) has nothing to actually
// choose, so it collapses to a locked, read-only Input instead of a
// Dropdown with a single (or zero) option.
export function TournamentDayPicker({
  label, value, onChange, days, placeholder = "Select a date", locked, size = "md", fullWidth, error,
}: TournamentDayPickerProps) {
  if (days.length <= 1) {
    return (
      <Input
        label={label}
        value={days.length === 1 ? formatDayLabel(days[0]) : "Loading tournament dates…"}
        locked
        size={size}
        fullWidth={fullWidth}
      />
    );
  }
  return (
    <Dropdown
      label={label}
      value={value}
      onChange={onChange}
      options={days.map((d) => ({ value: d, label: formatDayLabel(d) }))}
      placeholder={placeholder}
      locked={locked}
      size={size}
      fullWidth={fullWidth}
      error={error}
    />
  );
}
