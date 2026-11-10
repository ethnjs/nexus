"use client";

import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { ZoneChip } from "@/components/tournament/zones/ZoneChip";
import { enterIndex, type ListOption, OptionList, stepActive } from "@/components/ui/OptionList";
import { ApiError } from "@/lib/api";

export interface ZoneTagChip {
  key: string | number;
  dragId: string;
  label: string;
  title?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
}

/** A row the field offers. Rows sharing a `group` sit under one heading, so
 *  they must already be ordered by group. */
export interface ZoneTagOption<T> {
  key: string | number;
  value: T;
  label: string;
  /** Under the label, e.g. "In North". */
  note?: string | null;
  badge?: ReactNode;
  group?: string;
  searchText: string;
}

interface ZoneTagFieldProps<T> {
  chips: ZoneTagChip[];
  options: ZoneTagOption<T>[];
  locked: boolean;
  placeholder: string;
  emptyMessage: string;
  onAdd: (value: T) => Promise<void>;
  onRemove: (key: string | number) => void;
}

/** Chips and a search in one box: type after the last chip to add one. */
export function ZoneTagField<T>({
  chips,
  options,
  locked,
  placeholder,
  emptyMessage,
  onAdd,
  onRemove,
}: ZoneTagFieldProps<T>) {
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | undefined>(undefined);
  const [focused, setFocused] = useState(false);

  const query = text.trim().toLowerCase();
  const matches = query
    ? options.filter((o) => o.searchText.toLowerCase().includes(query))
    : options;
  const listOptions: ListOption[] = matches.map((o) => ({
    key: String(o.key),
    label: o.label,
    subtitle: o.note ?? undefined,
    badge: o.badge,
    group: o.group,
  }));

  async function pick(index: number) {
    const option = matches[index];
    if (!option) return;
    try {
      await onAdd(option.value);
      setText("");
      setActive(-1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add.");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => stepActive(listOptions, i, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && open) {
      const index = enterIndex(listOptions, active);
      if (index < 0) return;
      e.preventDefault();
      void pick(index);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Backspace" && text === "" && chips.length > 0) {
      e.preventDefault();
      onRemove(chips[chips.length - 1].key);
    }
  }

  return (
    <div>
      <div
        ref={boxRef}
        onClick={() => inputRef.current?.focus()}
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "6px",
          minHeight: "32px",
          padding: "4px 6px",
          background: locked ? "var(--color-accent-subtle)" : "var(--color-surface)",
          border: `1px solid ${
            error
              ? "var(--color-danger)"
              : focused
                ? "var(--color-border-strong)"
                : "var(--color-border)"
          }`,
          borderRadius: "var(--radius-md)",
          cursor: locked ? "default" : "text",
          transition: "border-color 150ms ease",
        }}
      >
        {locked && chips.length === 0 && (
          <span
            style={{
              padding: "0 4px",
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-text-tertiary)",
            }}
          >
            None
          </span>
        )}
        {chips.map((chip) => (
          <ZoneChip
            key={chip.key}
            dragId={chip.dragId}
            label={chip.label}
            title={chip.title}
            icon={chip.icon}
            trailing={chip.trailing}
            locked={locked}
            onRemove={() => onRemove(chip.key)}
          />
        ))}
        {!locked && (
          <input
            ref={inputRef}
            type="text"
            value={text}
            placeholder={chips.length === 0 ? placeholder : "Add…"}
            onChange={(e) => {
              setText(e.target.value);
              setError(undefined);
              setOpen(true);
              setActive(-1);
            }}
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onBlur={() => {
              setFocused(false);
              setOpen(false);
              setText("");
              setActive(-1);
            }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              minWidth: "80px",
              height: "22px",
              padding: "0 4px",
              border: "none",
              outline: "none",
              background: "transparent",
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--color-text-primary)",
            }}
          />
        )}
      </div>
      {error && (
        <p
          style={{
            margin: "4px 0 0",
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </p>
      )}
      {open && !locked && (
        <OptionList
          anchorRef={boxRef}
          options={listOptions}
          active={active}
          onActiveChange={setActive}
          onPick={(index) => void pick(index)}
          size="sm"
          matchWidth
          // The box grows as chips are added; following it would pull rows out from under the cursor.
          followAnchor={false}
          emptyMessage={emptyMessage}
        />
      )}
    </div>
  );
}
