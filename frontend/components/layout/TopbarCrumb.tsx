"use client";

import { Dropdown } from "@/components/ui/Dropdown";
import { IconChevronDown } from "@/components/ui/Icons";
import { usePageCrumb } from "@/lib/usePageCrumb";
import styles from "./Topbar.module.css";

/**
 * The collapsed page's title in the Topbar - "Assignments", or
 * "Assignments / Day 2" with the tab half as a Dropdown.
 *
 * A real Dropdown rather than a bare Popover on a span: it is the same
 * control as the tournament switcher two items to its left, and it brings
 * its own keyboard handling, panel placement and empty state along with it.
 */
export function TopbarCrumb() {
  const crumb = usePageCrumb();
  if (!crumb) return null;
  const tabs = crumb.tabs ?? [];

  return (
    // Stretched to the bar's full height, so the caret below can hang off its
    // bottom edge - `top: 100%` on a vertically centred box would leave it
    // floating inside the bar.
    <div
      style={{
        position: "relative", alignSelf: "stretch",
        display: "flex", alignItems: "center", gap: "8px", minWidth: 0,
        fontFamily: "var(--font-sans)", fontSize: "13px",
        // Opacity only. A keyframe that animates `transform` leaves this
        // element an animated-transform ancestor for as long as the effect is
        // in force - and `fill-mode: both` means forever - which makes it the
        // containing block for every `position: fixed` descendant. The tab
        // Dropdown's panel is one: it computed the right viewport `left` and
        // then had it resolved against this box, landing it hundreds of
        // pixels to the right, off screen.
        animation: "crumb-in 200ms ease both",
      }}
    >
      <style>{"@keyframes crumb-in { from { opacity: 0 } }"}</style>

      {/* Plain text: the control that folds the header is the caret below,
          in one place, rather than a second one on the title. */}
      <span style={{ fontWeight: 600, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>
        {crumb.title}
      </span>

      {tabs.length > 0 && crumb.activeKey !== undefined && (
        <>
          <span style={{ color: "var(--color-text-tertiary)" }}>/</span>
          <Dropdown
            size="sm"
            variant="transparent"
            fitContent
            value={crumb.activeKey}
            options={tabs.map((tab) => ({ value: tab.key, label: tab.label }))}
            onChange={(key) => crumb.onChange?.(key)}
          />
        </>
      )}

      {/* Hangs off the bar's bottom edge, centred on the crumb: the header
          folded up into this, so the way back is a pull down from the same
          place. Hovering the bar reveals it - Topbar.module.css owns that
          rule, since the bar is the thing being hovered. */}
      <button
        type="button"
        className={styles.crumbCaret}
        onClick={crumb.onExpand}
        title="Show page header"
        aria-label="Show page header"
      >
        <IconChevronDown size={13} />
      </button>
    </div>
  );
}
