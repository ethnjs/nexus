"use client";

import { type KeyboardEvent, useId, useRef, useState } from "react";
import { IconClock } from "@/components/ui/Icons";
import { type ListOption, OptionList, stepActive } from "@/components/ui/OptionList";
import {
  PICKER_FIELD_BACKGROUNDS,
  PICKER_FIELD_SIZES,
  type PickerFieldCommonProps,
  type PickerFieldSize,
} from "@/components/ui/PickerField";
import { formatSpan, formatTimeOfDay, parseLooseTime } from "@/lib/timeFormat";

type Half = "start" | "end";

interface TimeRangePickerProps extends PickerFieldCommonProps {
  /** "HH:mm", or "" when unset. */
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  /** Lets either end stay empty, as in a bulk edit where blank keeps each
   *  item's own time. Otherwise a blank or unreadable entry reverts. */
  openEnds?: boolean;
}

const SLOT_MINUTES = 15;
const SLOTS = Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, i) => {
  const minutes = i * SLOT_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
// Where the list opens when the half is empty.
const DEFAULT_SLOT = "08:00";

// Wide enough for "12:45 PM" at each size's font.
const HALF_WIDTH: Record<PickerFieldSize, string> = {
  xs: "58px",
  sm: "62px",
  md: "70px",
  lg: "78px",
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "1h 30m" between two times of one day. */
function spanBetween(start: string, end: string): string {
  return formatSpan(`2000-01-01T${start}`, `2000-01-01T${end}`);
}

/**
 * A field holding a start and an end time. Each half takes loose typing
 * ("930a", "2pm") and, while focused, opens a list of 15-minute slots; the
 * end's list starts after the start and shows each slot's length.
 */
export function TimeRangePicker({
  start,
  end,
  onChange,
  openEnds = false,
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
}: TimeRangePickerProps) {
  const generatedId = useId();
  const startId = id ?? generatedId;
  const sizing = PICKER_FIELD_SIZES[size];
  const [editing, setEditing] = useState<Half | null>(null);
  const [draft, setDraft] = useState("");
  // Text typed since focus, still to be read. A ref: blur reads it in the same
  // tick that Enter or Escape settles it.
  const typed = useRef(false);
  const [active, setActive] = useState(-1);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  const value = { start, end };

  function slotsFor(half: Half): string[] {
    return half === "end" && start ? SLOTS.filter((s) => s > start) : SLOTS;
  }

  const slots = editing ? slotsFor(editing) : [];
  const options: ListOption[] = slots.map((s) => ({
    key: s,
    label: formatTimeOfDay(s),
    selected: editing !== null && s === value[editing],
    badge:
      editing === "end" && start ? (
        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
          {spanBetween(start, s)}
        </span>
      ) : undefined,
  }));

  /** The slot at or just after `hhmm`, so an off-slot time lands nearby. */
  function slotIndex(half: Half, hhmm: string): number {
    const list = slotsFor(half);
    const i = list.findIndex((s) => s >= hhmm);
    return i === -1 ? list.length - 1 : i;
  }

  function focusHalf(half: Half) {
    setEditing(half);
    setDraft(formatTimeOfDay(value[half]));
    typed.current = false;
    setActive(slotIndex(half, value[half] || DEFAULT_SLOT));
  }

  /** Applies a time to one half, or reports it can't stand. */
  function commit(half: Half, next: string): boolean {
    if (!next) {
      if (!openEnds) return false;
      onChange(half === "start" ? "" : start, half === "end" ? "" : end);
      return true;
    }
    if (half === "start") {
      // Past the end, the end moves with it and the length stays.
      if (!openEnds && end && next >= end) {
        const length = start && end > start ? toMinutes(end) - toMinutes(start) : SLOT_MINUTES;
        onChange(next, fromMinutes(Math.min(toMinutes(next) + length, 24 * 60 - 1)));
      } else {
        onChange(next, end);
      }
      return true;
    }
    if (start && next <= start) return false;
    onChange(start, next);
    return true;
  }

  function commitDraft(half: Half) {
    const text = draft.trim();
    const parsed = text ? parseLooseTime(text, value[half] || "12:00") : "";
    if (parsed === null || !commit(half, parsed)) setDraft(formatTimeOfDay(value[half]));
  }

  function pickSlot(half: Half, index: number) {
    const slot = slotsFor(half)[index];
    if (!slot || !commit(half, slot)) return;
    setDraft(formatTimeOfDay(slot));
    typed.current = false;
    moveOn(half);
  }

  // On to the end once the start is in, after the parent has re-rendered with
  // it, so the end's list is built from the new start.
  function moveOn(half: Half) {
    if (half === "start") setTimeout(() => endRef.current?.focus());
    else endRef.current?.blur();
  }

  function handleKeyDown(half: Half, e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => stepActive(options, a, e.key === "ArrowDown" ? 1 : -1));
        typed.current = false;
        break;
      case "Enter":
        e.preventDefault();
        if (typed.current) {
          commitDraft(half);
          typed.current = false;
          moveOn(half);
        } else if (active >= 0) {
          pickSlot(half, active);
        }
        break;
      case "Escape":
        if (editing === null) break;
        // Kept from a modal around the field, which would close on it too.
        e.preventDefault();
        e.stopPropagation();
        typed.current = false;
        e.currentTarget.blur();
        break;
    }
  }

  function halfInput(half: Half) {
    const isEditing = editing === half;
    return (
      <input
        ref={half === "start" ? startRef : endRef}
        id={half === "start" ? startId : undefined}
        aria-label={`${ariaLabel ?? label ?? "Time"} ${half}`}
        type="text"
        autoComplete="off"
        disabled={locked}
        placeholder={half === "start" ? "Start" : "End"}
        value={isEditing ? draft : formatTimeOfDay(value[half])}
        onFocus={(e) => {
          focusHalf(half);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          typed.current = true;
          const parsed = parseLooseTime(e.target.value, value[half] || "12:00");
          if (parsed) setActive(slotIndex(half, parsed));
        }}
        onBlur={() => {
          if (typed.current) commitDraft(half);
          setEditing((h) => (h === half ? null : h));
        }}
        onKeyDown={(e) => handleKeyDown(half, e)}
        style={{
          width: HALF_WIDTH[size],
          height: "100%",
          padding: 0,
          fontFamily: "var(--font-sans)",
          fontSize: sizing.fontSize,
          fontWeight: 500,
          color: locked ? "var(--color-text-tertiary)" : "var(--color-text-primary)",
          background: "transparent",
          border: "none",
          outline: "none",
          cursor: locked ? "not-allowed" : "text",
        }}
      />
    );
  }

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
            htmlFor={startId}
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: fullWidth ? "100%" : undefined,
          height: sizing.height,
          padding: `0 ${sizing.paddingX}`,
          boxSizing: "border-box",
          background: locked
            ? "var(--color-accent-subtle)"
            : error
              ? "var(--color-danger-subtle)"
              : PICKER_FIELD_BACKGROUNDS[variant],
          border: `1px solid ${
            error
              ? "var(--color-danger)"
              : editing
                ? "var(--color-border-strong)"
                : "var(--color-border)"
          }`,
          borderRadius: "var(--radius-md)",
          cursor: locked ? "not-allowed" : undefined,
          transition: "border-color 150ms ease",
        }}
      >
        <span style={{ display: "flex", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
          <IconClock size={14} />
        </span>
        {halfInput("start")}
        <span style={{ color: "var(--color-text-tertiary)", fontSize: sizing.fontSize }}>–</span>
        {halfInput("end")}
      </div>

      {editing && (
        <OptionList
          anchorRef={editing === "start" ? startRef : endRef}
          label={editing === "start" ? "Start times" : "End times"}
          options={options}
          active={active}
          onActiveChange={setActive}
          onPick={(i) => pickSlot(editing, i)}
          size={size === "xs" || size === "sm" ? "sm" : "md"}
        />
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
