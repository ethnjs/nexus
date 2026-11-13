"use client";

import { IconEye } from "@/components/ui/Icons";
import { ToolbarConfigButton } from "@/components/ui/ToolbarConfigButton";

interface DisplayButtonProps {
  /** Whether what is shown differs from this surface's default view. */
  active: boolean;
  /** Opens the display config modal. */
  onOpen: () => void;
  /** The right segment's action, in one press. */
  onReset: () => void;
  /** Tooltip on that segment. */
  resetLabel?: string;
  size?: "sm" | "md";
  /** Eye only, no label — for a panel header. */
  iconOnly?: boolean;
  /** Label, and the tooltip when iconOnly. */
  label?: string;
}

/**
 * The toolbar's Display control — FilterButton's twin, for what is *shown*
 * rather than what is *listed*.
 *
 * Same argument for folding the reset in: a view cut down to three fields
 * needs a way back that doesn't involve re-ticking nine checkboxes, and a
 * separate Reset button beside it would reflow the toolbar every time the
 * view changed.
 */
export function DisplayButton({
  active,
  onOpen,
  onReset,
  size = "md",
  iconOnly = false,
  label = "Display",
  resetLabel = "Reset display",
}: DisplayButtonProps) {
  return (
    <ToolbarConfigButton
      active={active}
      icon={<IconEye size={size === "sm" ? 14 : 16} />}
      label={label}
      actionLabel={resetLabel}
      onOpen={onOpen}
      onClear={onReset}
      size={size}
      iconOnly={iconOnly}
    />
  );
}
