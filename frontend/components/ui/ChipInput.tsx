"use client";

import { ClipboardEvent, KeyboardEvent, ReactNode, useState } from "react";
import { IconLock, IconX } from "@/components/ui/Icons";
import { Tooltip } from "@/components/ui/Tooltip";

export type ChipStatus = "default" | "warning" | "error";
export type ChipInputVariant = "primary" | "secondary" | "transparent";
export type ChipInputSize = "xs" | "sm" | "md" | "lg";

interface ChipInputProps {
  value: string[];
  onChange: (chips: string[]) => void;
  label?: string;
  error?: string;
  placeholder?: string;
  fullWidth?: boolean;
  /** Per-chip styling hook — e.g. flag an invalid or already-known value. Defaults to "default" for every chip. */
  getChipStatus?: (chip: string) => ChipStatus;
  /** Hides the free-text field — chips are still removable via their "x", but new ones can only arrive through onChange from outside (e.g. a picker). For values with no free-text meaning, like role names. */
  disableInput?: boolean;
  /** Read-only — hides every chip's "x", so nothing can be removed. Typing/pasting are unaffected by this alone; pair with disableInput for a fully static display. */
  locked?: boolean;
  /** Per-chip lock, independent of `locked` — chips this returns a reason for show a lock icon (tooltipped with that reason) instead of "x" and can't be removed, while the rest of the chips stay removable. Return undefined for a removable chip. For a reason specific to that chip's value (e.g. a role that ties/outranks the actor), as opposed to `locked`'s blanket "nothing here is editable." */
  chipLockReason?: (chip: string) => string | undefined;
  /** Per-chip hover tooltip — for detail that would overcrowd the chip text itself (e.g. a shift's time range when the chip already shows label + day). Return undefined for a chip with nothing extra to show. */
  getChipTooltip?: (chip: string) => string | undefined;
  variant?: ChipInputVariant;
  size?: ChipInputSize;
  /** Rendered as the last item in the chip row (wraps with the chips), e.g. an "add" popover trigger. */
  addButton?: ReactNode;
}

const STATUS_STYLES: Record<ChipStatus, { background: string; color: string; border: string }> = {
  default: { background: "var(--color-accent-subtle)", color: "var(--color-text-primary)",  border: "var(--color-border)" },
  warning: { background: "var(--color-warning-subtle)", color: "var(--color-warning)",       border: "var(--color-warning)" },
  error:   { background: "var(--color-danger-subtle)",  color: "var(--color-danger)",        border: "var(--color-danger)" },
};

// primary -- var(--color-bg); secondary -- var(--color-surface); transparent -- none.
const VARIANT_BACKGROUND: Record<ChipInputVariant, string> = {
  primary:     "var(--color-bg)",
  secondary:   "var(--color-surface)",
  transparent: "transparent",
};

// Heights match Input/Button's scale — same size name, same height everywhere.
// minHeight (not height) since chips can wrap to multiple lines.
const SIZE_MAP: Record<ChipInputSize, { minHeight: string; paddingX: string; fontSize: string }> = {
  xs: { minHeight: "26px", paddingX: "6px",  fontSize: "12px" },
  sm: { minHeight: "28px", paddingX: "8px",  fontSize: "12px" },
  md: { minHeight: "36px", paddingX: "8px",  fontSize: "13px" },
  lg: { minHeight: "48px", paddingX: "10px", fontSize: "14px" },
};

// Splits on comma or newline — covers both typed Enter and pasted
// comma/newline-separated lists (e.g. copied from a spreadsheet column).
const SPLIT_PATTERN = /[,\n]+/;

// A chip's own "x" — plain native button (Button.tsx's smallest size is
// 28px with a visible border, too bulky for an inline glyph next to
// chip text) with its own hover background, since browsers give none.
function ChipRemoveButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "none", borderRadius: "var(--radius-sm)", background: "transparent",
        padding: "2px", color: "inherit", cursor: "pointer",
        // An inset box-shadow acts as a darkening film regardless of which
        // status color the chip itself is using as background (default/
        // warning/error) — a fixed background color would wash out against
        // some of those and be invisible against others.
        boxShadow: hovered ? "inset 0 0 0 999px rgba(0,0,0,0.12)" : undefined,
        transition: "box-shadow 100ms ease",
      }}
    >
      <IconX size={10} />
    </button>
  );
}

// Generic tag/chip entry — type-and-Enter or paste a comma/newline-separated
// list, chips removable via an "x". Content-agnostic: format validation and
// duplicate/match warnings are the consumer's job via getChipStatus.
export function ChipInput({
  value, onChange, label, error, placeholder, fullWidth, getChipStatus, disableInput, locked, chipLockReason,
  getChipTooltip, variant = "primary", size = "md", addButton,
}: ChipInputProps) {
  const [draft, setDraft] = useState("");
  const sizing = SIZE_MAP[size];

  function addChips(raw: string) {
    const tokens = raw.split(SPLIT_PATTERN).map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) return;
    const deduped = tokens.filter((t) => !value.includes(t));
    if (deduped.length > 0) onChange([...value, ...deduped]);
  }

  function removeChip(chip: string) {
    onChange(value.filter((c) => c !== chip));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      addChips(draft);
      setDraft("");
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      removeChip(value[value.length - 1]);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!SPLIT_PATTERN.test(text)) return;
    e.preventDefault();
    addChips(text);
    setDraft("");
  }

  function handleBlur() {
    if (draft.trim()) {
      addChips(draft);
      setDraft("");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: fullWidth ? "100%" : undefined }}>
      {label && (
        <label style={{
          fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)",
        }}>
          {label}
        </label>
      )}

      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px",
        padding: variant === "transparent" ? "0" : `4px ${sizing.paddingX}`, minHeight: sizing.minHeight, boxSizing: "border-box",
        background: VARIANT_BACKGROUND[variant],
        border: error
          ? "1px solid var(--color-danger)"
          : variant === "transparent" ? "none" : "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)", width: fullWidth ? "100%" : undefined,
      }}>
        {value.map((chip) => {
          const status = getChipStatus?.(chip) ?? "default";
          const styles = STATUS_STYLES[status];
          const lockReason = chipLockReason?.(chip);
          const chipTooltip = getChipTooltip?.(chip);
          return (
            <span
              key={chip}
              style={{
                display: "inline-flex", alignItems: "center", gap: "5px",
                padding: "3px 6px 3px 9px", borderRadius: "var(--radius-sm)",
                background: styles.background, color: styles.color,
                border: `1px solid ${styles.border}`,
                fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: 500,
              }}
            >
              {chipTooltip ? (
                <Tooltip variant="info" message={chipTooltip} showIcon={false}>
                  {chip}
                </Tooltip>
              ) : chip}
              {!locked && lockReason && (
                <Tooltip variant="info" message={lockReason} showIcon={false}>
                  <span
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "2px", opacity: 0.7,
                    }}
                  >
                    <IconLock size={10} />
                  </span>
                </Tooltip>
              )}
              {!locked && !lockReason && (
                <ChipRemoveButton onClick={() => removeChip(chip)} />
              )}
            </span>
          );
        })}
        {!disableInput && (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={handleBlur}
            placeholder={value.length === 0 ? placeholder : undefined}
            style={{
              flex: 1, minWidth: "120px", border: "none", outline: "none",
              background: "transparent", fontFamily: "var(--font-sans)", fontSize: sizing.fontSize,
              color: "var(--color-text-primary)",
            }}
          />
        )}
        {addButton}
      </div>

      {error && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
