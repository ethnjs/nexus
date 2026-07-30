import { ReactNode } from "react";

export function ProfileCard({ children }: { children: ReactNode }) {
  return (
    <div style={{
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-sm)",
      padding: "28px",
      display: "flex",
      flexDirection: "column",
      gap: "28px",
    }}>
      {children}
    </div>
  );
}