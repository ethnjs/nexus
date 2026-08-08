import { CSSProperties, ReactNode } from "react";
import { Card } from "@/components/ui/Card";

interface SettingsRowProps {
  label:        string;
  helper?:      string;
  children:     ReactNode;
  last?:        boolean;
  contentStyle?: CSSProperties;
}

export function SettingsRow({ label, helper, children, last = false, contentStyle }: SettingsRowProps) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "24px",
      padding: "20px 0",
      borderBottom: last ? "none" : "1px solid var(--color-border)",
    }}>
      <div style={{ flexShrink: 0, maxWidth: "220px"}}>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>
          {label}
        </div>
        {helper && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
            {helper}
          </div>
        )}
      </div>
      {/* Relative, not a fixed px cap — scales with whatever layout wraps this
          row (tournament settings today, a narrower global account settings
          layout later) instead of being tuned to one specific container width. */}
      <div style={{ flex: 1, maxWidth: "60%", ...contentStyle }}>
        {children}
      </div>
    </div>
  );
}

interface SettingsSectionProps {
  title?:    string;
  children:  ReactNode;
  /** "danger" gives the section a red-accented border/title — use for irreversible/high-stakes actions. */
  variant?:  "normal" | "danger";
}

export function SettingsSection({ title, children, variant = "normal" }: SettingsSectionProps) {
  const accentColor = variant === "danger" ? "var(--color-danger)" : "var(--color-text-tertiary)";

  return (
    <Card radius="lg" variant={variant} style={{ marginBottom: "24px", padding: "8px 28px" }}>
      {title && (
        <div style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          letterSpacing: "0.06em", textTransform: "uppercase",
          color: accentColor, paddingTop: "20px",
        }}>
          {title}
        </div>
      )}
      <div>{children}</div>
    </Card>
  );
}
