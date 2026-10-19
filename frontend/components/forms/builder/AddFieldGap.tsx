"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/Icons";

const REST_HEIGHT = 12;
const OPEN_HEIGHT = 44;
// Long enough that moving the pointer across the list doesn't make every gap
// it passes jump open.
const REVEAL_DELAY_MS = 1000;

// The space above, between and below the question cards. Resting the pointer
// on it opens a thin "Add question" bar, nudging the card below down to make
// room; at rest it's just the usual gap, so an idle form looks unchanged.
export function AddFieldGap({
  onAdd,
  disabled = false,
  alwaysOpen = false,
  style,
}: {
  onAdd: () => void;
  /** Mid-drag or locked — stays a plain gap. */
  disabled?: boolean;
  /** Shows the bar without hovering — the one below the last question. */
  alwaysOpen?: boolean;
  style?: CSSProperties;
}) {
  const [revealed, setRevealed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = (alwaysOpen || revealed) && !disabled;

  function cancelReveal() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div
      onMouseEnter={() => {
        cancelReveal();
        timer.current = setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
      }}
      onMouseLeave={() => {
        cancelReveal();
        setRevealed(false);
      }}
      style={{
        height: `${open ? OPEN_HEIGHT : REST_HEIGHT}px`,
        transition: "height 120ms ease",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        ...style,
      }}
    >
      {open && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            setRevealed(false);
            onAdd();
          }}
          style={{
            width: "100%",
            border: "1px dashed var(--color-border-strong)",
            color: "var(--color-text-secondary)",
          }}
        >
          <IconPlus size={11} /> Add question
        </Button>
      )}
    </div>
  );
}
