"use client";

interface PanelFieldProps {
  label: string;
  children: React.ReactNode;
}

// The small-caps label + value block repeated throughout MemberPanel (and,
// eventually, the tournament sections on the member's own profile page) —
// pulled out once so every caller stays visually identical without hand
// copying the label styles.
export function PanelField({ label, children }: PanelFieldProps) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.06em",
        color: "var(--color-text-tertiary)", marginBottom: "5px",
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}
