import type { DayStatus } from "@/lib/zones";

const COLORS: Record<DayStatus, string> = {
  confirmed: "var(--color-success)",
  declined: "var(--color-danger)",
  unconfirmed: "var(--color-text-tertiary)",
};

const LABELS: Record<DayStatus, string> = {
  confirmed: "Confirmed",
  declined: "Declined",
  unconfirmed: "Not confirmed",
};

/** Green, red or gray: whether a member is confirmed for the day. */
export function DayStatusDot({ status, dayName }: { status: DayStatus; dayName: string }) {
  return (
    <span
      role="img"
      aria-label={`${LABELS[status]} for ${dayName}`}
      title={`${LABELS[status]} for ${dayName}`}
      style={{
        display: "inline-block",
        width: "7px",
        height: "7px",
        borderRadius: "50%",
        background: COLORS[status],
        flexShrink: 0,
      }}
    />
  );
}
