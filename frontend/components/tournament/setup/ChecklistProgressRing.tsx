export function ChecklistProgressRing({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? completed / total : 0;
  const size = 148;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <div
      role="progressbar"
      aria-valuenow={completed}
      aria-valuemin={0}
      aria-valuemax={total}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}
    >
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
        Setup progress
      </span>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-accent-subtle)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 200ms ease" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontFamily: "Georgia, serif", fontSize: "28px", color: "var(--color-text-primary)", lineHeight: 1 }}>
            {completed}/{total}
          </span>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
            complete
          </span>
        </div>
      </div>
    </div>
  );
}
