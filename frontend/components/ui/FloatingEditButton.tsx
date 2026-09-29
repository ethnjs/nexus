"use client";

import Link from "next/link";
import { IconEdit, IconLock } from "@/components/ui/Icons";
import styles from "./FloatingEditButton.module.css";

interface FloatingEditButtonProps {
  /** Where editing happens — this page's own edit route. */
  href: string;
  title?: string;
  /** Set when editing is closed: the button stays in place, shows a lock, and
   *  says why on hover or focus instead of navigating. */
  lockedReason?: string;
}

// The "edit what you're looking at" affordance for a whole page, as opposed
// to a control for one field: a record you read top to bottom has no single
// place a header button belongs, so it sits over the page instead.
export function FloatingEditButton({ href, title = "Edit", lockedReason }: FloatingEditButtonProps) {
  if (lockedReason) {
    // A focusable button rather than a disabled one: a disabled control fires
    // no mouse events, so the reason would never open. The shared Tooltip
    // can't be used either — it always opens below its trigger, which here is
    // off the bottom of the screen.
    return (
      <button type="button" aria-disabled="true" aria-label={`${title} — ${lockedReason}`} className={`${styles.button} ${styles.locked}`}>
        <IconLock size={20} />
        <span role="tooltip" className={styles.reason}>{lockedReason}</span>
      </button>
    );
  }
  return (
    <Link href={href} title={title} aria-label={title} className={styles.button}>
      <IconEdit size={20} />
    </Link>
  );
}
