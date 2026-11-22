"use client";

import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from "input-otp";
import { forwardRef, useId } from "react";
import styles from "./CodeInput.module.css";

interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires once every slot is filled, by typing, pasting or the OS autofilling the code. */
  onComplete?: (value: string) => void;
  length?: number;
  label?: string;
  error?: string;
  locked?: boolean;
  autoFocus?: boolean;
}

/** A digits-only code split into one box per digit, over a single real input. */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(
  ({ value, onChange, onComplete, length = 6, label, error, locked, autoFocus }, ref) => {
    const inputId = useId();

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
        {label && (
          <label
            htmlFor={inputId}
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
          </label>
        )}
        <OTPInput
          ref={ref}
          id={inputId}
          value={value}
          onChange={onChange}
          onComplete={onComplete}
          maxLength={length}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={locked}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          containerClassName={styles.container}
          render={({ slots }) => (
            <div style={{ display: "flex", gap: "8px", width: "100%" }}>
              {slots.map((slot, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: slots are fixed positions
                <Slot key={i} {...slot} error={!!error} locked={locked} />
              ))}
            </div>
          )}
        />
        {error && (
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-danger)",
            }}
          >
            {error}
          </p>
        )}
      </div>
    );
  },
);

CodeInput.displayName = "CodeInput";

function Slot({
  char,
  isActive,
  hasFakeCaret,
  error,
  locked,
}: SlotProps & { error: boolean; locked?: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        height: "48px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
        fontSize: "20px",
        background: locked
          ? "var(--color-accent-subtle)"
          : error
            ? "var(--color-danger-subtle)"
            : "var(--color-bg)",
        color: locked ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
        border: `1px solid ${
          error
            ? "var(--color-danger)"
            : isActive
              ? "var(--color-border-strong)"
              : "var(--color-border)"
        }`,
        borderRadius: "var(--radius-md)",
        transition: "border-color 150ms ease",
      }}
    >
      {char}
      {hasFakeCaret && <div className={styles.caret} />}
    </div>
  );
}
