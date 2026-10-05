import type { KeyboardEvent } from "react";

/**
 * Props that make a clickable table row reachable by keyboard: Tab lands on
 * it, Enter or Space activates it. Only the row's own keypresses count — one
 * bubbling up from a checkbox or button inside it is that control's.
 */
export function rowActivation(onActivate: (() => void) | undefined) {
  if (!onActivate) return {};
  return {
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      onActivate();
    },
  };
}
