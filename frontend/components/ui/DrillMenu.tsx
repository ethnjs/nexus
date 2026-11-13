"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { IconChevronLeft, IconChevronRight } from "@/components/ui/Icons";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * A menu that drills into submenus: every open level sits side by side in a
 * strip that slides one level left per step, and each level past the first
 * gets a Back header. The caller owns the stack, pushing on a row's click.
 */
export function DrillMenu<T>({
  stack,
  titleOf,
  renderLevel,
  onBack,
  footer,
}: {
  stack: T[];
  /** The Back header's title; the first level has no header. */
  titleOf: (level: T) => string;
  renderLevel: (level: T) => ReactNode;
  onBack: () => void;
  /** Below the strip, on every level. */
  footer?: ReactNode;
}) {
  const depth = stack.length - 1;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            width: `${stack.length * 100}%`,
            // Not a transform: a transformed strip becomes the containing
            // block for fixed children, which pulls a row's Tooltip into it.
            marginLeft: `-${depth * 100}%`,
            transition: "margin-left 200ms ease",
          }}
        >
          {stack.map((level, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a stack that is only pushed and popped at the end
              key={i}
              style={{ width: `${100 / stack.length}%`, flexShrink: 0 }}
            >
              {i > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 6px 2px",
                  }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    iconOnly
                    title="Back"
                    onClick={onBack}
                  >
                    <IconChevronLeft size={12} />
                  </Button>
                  <span
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {titleOf(level)}
                  </span>
                </div>
              )}
              <div style={{ maxHeight: "320px", overflowY: "auto", padding: "6px" }}>
                {renderLevel(level)}
              </div>
            </div>
          ))}
        </div>
      </div>
      {footer && (
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "6px" }}>{footer}</div>
      )}
    </div>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 10px 4px",
        fontFamily: "var(--font-sans)",
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
      }}
    >
      {children}
    </div>
  );
}

export function MenuNote({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "4px 10px",
        fontFamily: "var(--font-sans)",
        fontSize: "12px",
        color: "var(--color-text-tertiary)",
      }}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  children,
  chevron = false,
  disabledReason,
  onClick,
}: {
  children: ReactNode;
  /** Marks a row that drills into a submenu. */
  chevron?: boolean;
  /** Given, the row is disabled and this shows on hover. */
  disabledReason?: string;
  onClick: () => void;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      fullWidth
      disabled={!!disabledReason}
      onClick={onClick}
      style={{ justifyContent: "space-between", fontWeight: 500 }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </span>
      {chevron && <IconChevronRight size={12} />}
    </Button>
  );
  return disabledReason ? (
    // Clips the Tooltip's hover bridge, which hangs below the row and would
    // make the level scroll. The bubble is fixed, so it isn't clipped.
    <div style={{ overflow: "hidden" }}>
      <Tooltip variant="info" showIcon={false} message={disabledReason} style={{ width: "100%" }}>
        {button}
      </Tooltip>
    </div>
  ) : (
    button
  );
}
