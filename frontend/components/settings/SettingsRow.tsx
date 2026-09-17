import { CSSProperties, ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import styles from "./Settings.module.css";

interface SettingsRowProps {
  label:        ReactNode;
  helper?:      string;
  children:     ReactNode;
  last?:        boolean;
  contentStyle?: CSSProperties;
}

export function SettingsRow({ label, helper, children, last = false, contentStyle }: SettingsRowProps) {
  return (
    <div className={last ? `${styles.row} ${styles.rowLast}` : styles.row}>
      <div className={styles.rowLabel}>
        <div className={styles.rowLabelText}>
          {label}
        </div>
        {helper && (
          <div className={styles.rowHelper}>
            {helper}
          </div>
        )}
      </div>
      {/* Label and control stack on a phone — see Settings.module.css. */}
      <div className={styles.rowControl} style={contentStyle}>
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
    <Card radius="lg" variant={variant} className={styles.section}>
      {title && (
        <div className={styles.sectionTitle} style={{ color: accentColor }}>
          {title}
        </div>
      )}
      <div>{children}</div>
    </Card>
  );
}
