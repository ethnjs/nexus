"use client";

import { Dropdown } from "@/components/ui/Dropdown";
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
// choose, so the dropdown itself locks — same control either way, just
// disabled when there's nothing to pick between.
export function TournamentDayPicker({
  label, value, onChange, days, placeholder = "Select a date", locked, size = "md", fullWidth, error,
}: TournamentDayPickerProps) {
  return (
    <Dropdown
      label={label}
      value={value}
      onChange={onChange}
      options={days.map((d) => ({ value: d, label: formatDayLabel(d) }))}
      placeholder={days.length === 0 ? "Loading tournament dates…" : placeholder}
      locked={locked || days.length <= 1}
      size={size}
      fullWidth={fullWidth}
      error={error}
    />
  );
}
