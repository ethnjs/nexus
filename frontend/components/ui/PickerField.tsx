"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IconX } from "@/components/ui/Icons";
import styles from "./PickerField.module.css";

export type PickerFieldSize = "xs" | "sm" | "md" | "lg";
export type PickerFieldVariant = "primary" | "secondary";

/** The props every picker built on PickerField passes straight through. */
export interface PickerFieldCommonProps {
  label?: string;
  labelExtra?: ReactNode;
  required?: boolean;
  error?: string;
  helper?: string;
  locked?: boolean;
  size?: PickerFieldSize;
  variant?: PickerFieldVariant;
  fullWidth?: boolean;
  id?: string;
  "aria-label"?: string;
}

interface PickerFieldProps extends PickerFieldCommonProps {
  icon: ReactNode;
  /** What the field reads; null shows the placeholder. */
  display: ReactNode | null;
  placeholder: string;
  /** Given, the field grows an "x" while it has a value. */
  onClear?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelLabel: string;
  panel: ReactNode;
  panelStyle?: CSSProperties;
}

const SIZE_MAP: Record<PickerFieldSize, { height: string; paddingX: string; fontSize: string }> = {
  xs: { height: "26px", paddingX: "8px", fontSize: "12px" },
  sm: { height: "28px", paddingX: "10px", fontSize: "13px" },
  md: { height: "36px", paddingX: "10px", fontSize: "14px" },
  lg: { height: "48px", paddingX: "16px", fontSize: "15px" },
};

const BACKGROUND_MAP: Record<PickerFieldVariant, string> = {
  primary: "var(--color-bg)",
  secondary: "var(--color-surface)",
};

const PANEL_GAP = 4;
// Kept clear between the panel and the viewport edge.
const VIEWPORT_MARGIN = 8;
// Roughly a panel's height, for deciding whether it fits below the field.
const PANEL_HEIGHT = 340;

type Pos = { left: number; maxHeight: number } & (
  | { top: number; bottom?: undefined }
  | { bottom: number; top?: undefined }
);

/**
 * The field and floating panel the date and time pickers share: a labelled
 * button styled like Input that opens `panel` below it, or above when there's
 * more room there. Outside clicks and Escape close it.
 */
export function PickerField({
  label,
  labelExtra,
  required,
  error,
  helper,
  locked,
  size = "md",
  variant = "primary",
  fullWidth,
  id,
  "aria-label": ariaLabel,
  icon,
  display,
  placeholder,
  onClear,
  open,
  onOpenChange,
  panelLabel,
  panel,
  panelStyle,
}: PickerFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const sizing = SIZE_MAP[size];
  const [focused, setFocused] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const showClear = !!onClear && !locked && display !== null;

  // Cleared on close, so the next opening is placed afresh rather than
  // flashing at the old spot.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setPos(null);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = fieldRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - PANEL_GAP;
      const above = r.top - PANEL_GAP;
      const flip = below < PANEL_HEIGHT && above > below;
      const maxHeight = Math.round((flip ? above : below) - VIEWPORT_MARGIN);
      const left = Math.round(r.left);
      setPos(
        flip
          ? { bottom: Math.round(window.innerHeight - r.top + PANEL_GAP), left, maxHeight }
          : { top: Math.round(r.bottom + PANEL_GAP), left, maxHeight },
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attaching on every render's fresh onOpenChange isn't needed
  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent) {
      const target = e.target as Node;
      if (fieldRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onOpenChange(false);
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [open]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Already handled by a control inside, such as a Dropdown closing its list.
    if (e.key !== "Escape" || e.defaultPrevented) return;
    // Kept from a modal around the field, which would close on it too.
    e.preventDefault();
    e.stopPropagation();
    onOpenChange(false);
  }

  const borderColor = error
    ? "var(--color-danger)"
    : open || focused
      ? "var(--color-border-strong)"
      : "var(--color-border)";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        width: fullWidth ? "100%" : undefined,
      }}
    >
      {label && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label
            htmlFor={fieldId}
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
            {required && <span style={{ color: "var(--color-danger)" }}> *</span>}
          </label>
          {labelExtra}
        </div>
      )}
      <div ref={fieldRef} style={{ position: "relative", width: fullWidth ? "100%" : undefined }}>
        <button
          id={fieldId}
          type="button"
          disabled={locked}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "100%",
            height: sizing.height,
            padding: `0 ${showClear ? `calc(${sizing.paddingX} * 2 + 12px)` : sizing.paddingX} 0 ${sizing.paddingX}`,
            fontFamily: "var(--font-sans)",
            fontSize: sizing.fontSize,
            fontWeight: 500,
            textAlign: "left",
            color:
              display !== null && !locked
                ? "var(--color-text-primary)"
                : "var(--color-text-tertiary)",
            background: locked
              ? "var(--color-accent-subtle)"
              : error
                ? "var(--color-danger-subtle)"
                : BACKGROUND_MAP[variant],
            border: `1px solid ${borderColor}`,
            borderRadius: "var(--radius-md)",
            outline: "none",
            cursor: locked ? "not-allowed" : "pointer",
            transition: "border-color 150ms ease",
          }}
        >
          <span style={{ display: "flex", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
            {icon}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {display ?? placeholder}
          </span>
        </button>
        {showClear && (
          <button
            type="button"
            title="Clear"
            aria-label="Clear"
            onClick={() => {
              onClear();
              onOpenChange(false);
            }}
            className="link-subtle"
            style={{
              position: "absolute",
              right: sizing.paddingX,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
            }}
          >
            <IconX size={12} />
          </button>
        )}
      </div>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={panelLabel}
          onKeyDown={handleKeyDown}
          className={`${styles.panel} ${pos.top === undefined ? styles.panelAbove : ""}`}
          style={{
            position: "fixed",
            left: pos.left,
            ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
            maxHeight: `${pos.maxHeight}px`,
            overflowY: "auto",
            zIndex: 9999,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
            ...panelStyle,
          }}
        >
          {panel}
        </div>
      )}

      {error && (
        <p
          style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}
        >
          {error}
        </p>
      )}
      {helper && !error && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-tertiary)",
          }}
        >
          {helper}
        </p>
      )}
    </div>
  );
}
