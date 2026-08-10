// Shared between the create-invite modal (initial expiry) and the per-row
// "add time" popover (extends expires_at) — same preset spans, "forever"
// only makes sense at creation, not as an add_hours extension.
export const HOUR_PRESETS: { value: string; label: string; hours: number }[] = [
  { value: "1h", label: "1 hour", hours: 1 },
  { value: "4h", label: "4 hours", hours: 4 },
  { value: "8h", label: "8 hours", hours: 8 },
  { value: "12h", label: "12 hours", hours: 12 },
  { value: "1d", label: "1 day", hours: 24 },
  { value: "1w", label: "1 week", hours: 24 * 7 },
  { value: "30d", label: "30 days", hours: 24 * 30 },
];

// Dropdown options for a new invite's expiry — HOUR_PRESETS plus "forever",
// which only makes sense at creation (add_hours has no "make it forever").
export const EXPIRY_PRESETS = [
  ...HOUR_PRESETS.map(({ value, label }) => ({ value, label })),
  { value: "forever", label: "Forever" },
];

// preset value -> hours, for every fixed preset. "forever" is handled
// separately by the caller (null expires_in_hours).
export const PRESET_HOURS: Record<string, number> = Object.fromEntries(
  HOUR_PRESETS.map(({ value, hours }) => [value, hours])
);
