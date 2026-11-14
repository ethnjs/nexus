"use client";

import { useEffect, useRef, useState } from "react";
import { pillStyle } from "@/components/ui/PillMenu";

interface PillInputProps {
  value: number;
  /** Fires on Enter or blur with a whole number ≥ `min` that differs from
   *  `value` — not per keystroke, since a commit is usually a save. Anything
   *  else snaps back to `value`. */
  onCommit: (value: number) => void;
  min?: number;
  disabled?: boolean;
  /** Accessible name — the pill has no visible label. */
  label: string;
  /** Focus (and select) on mount — e.g. the count of a role just added. */
  autoFocus?: boolean;
}

/**
 * A tiny number field that sits inside a chip (e.g. a role's head count on a
 * staffing chip), drawn as a PillMenu pill so it reads as the chip's one
 * control, and just wide enough for its value.
 */
export function PillInput({
  value,
  onCommit,
  min = 1,
  disabled = false,
  label,
  autoFocus = false,
}: PillInputProps) {
  const [text, setText] = useState(String(value));
  const [hasFocus, setHasFocus] = useState(false);
  // Adopt a new value from outside (a save landing) during render.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(String(value));
  }

  // Once, the first moment it's enabled: a pill mounted mid-save is disabled,
  // and the native autoFocus attribute would be ignored on a disabled field.
  const ref = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (autoFocus && !disabled && !focused.current) {
      focused.current = true;
      ref.current?.focus();
    }
  }, [autoFocus, disabled]);

  function commit() {
    const next = Number(text);
    if (Number.isInteger(next) && next >= min && next !== value) onCommit(next);
    else setText(String(value));
  }

  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={text}
      ref={ref}
      disabled={disabled}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
      onBlur={() => {
        setHasFocus(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setText(String(value));
        }
      }}
      onFocus={(e) => {
        setHasFocus(true);
        e.target.select();
      }}
      style={{
        ...pillStyle("default", "sm"),
        // Content-box so `ch` sizes the digits, with the pill's padding outside them.
        boxSizing: "content-box",
        width: `${Math.max(text.length, 1)}ch`,
        margin: 0,
        outline: "none",
        background: hasFocus ? "var(--color-accent-subtle)" : "transparent",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        textAlign: "center",
        cursor: disabled ? "default" : "text",
      }}
    />
  );
}
