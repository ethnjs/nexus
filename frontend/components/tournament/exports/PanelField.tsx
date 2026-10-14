import type { ReactNode } from "react";

interface PanelFieldProps {
  label: string;
  helper?: string;
  // Puts a small control (a switch) beside the label instead of under it.
  inline?: boolean;
  children: ReactNode;
}

/** A label over its control — the export side panel is too narrow for
 *  SettingsRow's side-by-side layout. Label styled like Input's. */
export function PanelField({ label, helper, inline = false, children }: PanelFieldProps) {
  const heading = (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "11px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: "var(--color-text-tertiary)",
        }}
      >
        {label}
      </span>
      {helper && (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-text-tertiary)",
          }}
        >
          {helper}
        </span>
      )}
    </div>
  );

  if (inline) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        {heading}
        {children}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {heading}
      {children}
    </div>
  );
}
