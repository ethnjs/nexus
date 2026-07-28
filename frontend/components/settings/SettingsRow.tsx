import { ReactNode } from "react";

interface SettingsRowProps {
  label:    string;
  helper?:  string;
  children: ReactNode;
  last?:    boolean;
}

export function SettingsRow({ label, helper, children, last = false }: SettingsRowProps) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "24px",
      padding: "20px 0",
      borderBottom: last ? "none" : "1px solid var(--color-border)",
    }}>
      <div style={{ flexShrink: 0, maxWidth: "220px", paddingTop: "10px" }}>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>
          {label}
        </div>
        {helper && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
            {helper}
          </div>
        )}
      </div>
      <div style={{ flex: 1, maxWidth: "360px" }}>
        {children}
      </div>
    </div>
  );
}

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: "40px" }}>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase",
        color: "var(--color-text-tertiary)", marginBottom: "4px",
      }}>
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}
