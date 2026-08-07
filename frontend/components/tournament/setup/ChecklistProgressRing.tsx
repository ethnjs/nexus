export function ChecklistProgressRing({
  completed,
  total,
  size = 200,
}: {
  completed: number;
  total: number;
  size?: number;
}) {
  const pct = total > 0 ? completed / total : 0;
  const strokeW = 8; // viewBox units (viewBox is 0 0 100 100)
  const radius = 50 - strokeW / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <div
      role="progressbar"
      aria-valuenow={completed}
      aria-valuemin={0}
      aria-valuemax={total}
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
        <circle cx={50} cy={50} r={radius} fill="none" stroke="var(--color-accent-subtle)" strokeWidth={strokeW} />
        <circle
          cx={50}
          cy={50}
          r={radius}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 200ms ease" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px",
      }}>
        <span style={{ fontFamily: "Georgia, serif", fontSize: "38px", color: "var(--color-text-primary)", lineHeight: 1 }}>
          {completed}/{total}
        </span>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
          tasks complete
        </span>
      </div>
    </div>
  );
}
