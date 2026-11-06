"use client";

import { type ReactNode, useId } from "react";
import { RadioCircle } from "@/components/ui/RadioCircle";
import styles from "@/components/ui/RadioList.module.css";

export interface RadioListOption {
  value: string;
  label: string;
  /** Rendered after the label, e.g. a "Removed" marker on a past answer. */
  badge?: ReactNode;
  /** Replaces the label, e.g. an Other option's text field. */
  content?: ReactNode;
}

interface RadioListProps {
  options: RadioListOption[];
  value: string;
  onChange: (value: string) => void;
  locked?: boolean;
  /** Radio circle diameter in px. */
  size?: number;
  fontSize?: string;
  gap?: string;
}

const ROW_HEIGHT = "36px";

// Plain radio-circle list — the fallback for single-select when option
// labels are too long for ButtonGroup's pill layout to read well. Each row
// holds a hidden native radio, so Tab, arrows and Space work as usual.
export function RadioList({
  options,
  value,
  onChange,
  locked = false,
  size = 16,
  fontSize = "13px",
  gap = "8px",
}: RadioListProps) {
  const name = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {options.map((opt) => (
        <RadioRow
          key={opt.value}
          name={name}
          option={opt}
          checked={!!value && value === opt.value}
          locked={locked}
          size={size}
          fontSize={fontSize}
          onClick={() => !locked && onChange(opt.value)}
        />
      ))}
    </div>
  );
}

function RadioRow({
  name,
  option,
  checked,
  locked,
  size,
  fontSize,
  onClick,
}: {
  name: string;
  option: RadioListOption;
  checked: boolean;
  locked: boolean;
  size: number;
  fontSize: string;
  onClick: () => void;
}) {
  return (
    // onClick, not just the radio's change: a click into a row's own content (an Other text
    // field) has to pick the row too, and labels don't forward those.
    <label
      className={styles.row}
      onClick={onClick}
      // Lets a read-only preview of this list report which option was
      // clicked (the form builder focuses that option's editor row).
      data-option-value={option.value}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        boxSizing: "border-box",
        // minHeight, not height: a label long enough to wrap would
        // otherwise overflow a fixed-height row.
        minHeight: ROW_HEIGHT,
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
        cursor: locked ? "default" : "pointer",
        position: "relative",
      }}
    >
      <input
        type="radio"
        name={name}
        value={option.value}
        checked={checked}
        disabled={locked}
        onChange={onClick}
        className={styles.input}
      />
      <RadioCircle checked={checked} disabled={locked} size={size} />
      {/* Dimmed to match the circle, which already greys itself when
          disabled — a locked row reads as inactive rather than as an option
          that simply isn't responding. */}
      {option.content ?? (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize,
            color: locked ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
          }}
        >
          {option.label}
        </span>
      )}
      {option.badge}
    </label>
  );
}
