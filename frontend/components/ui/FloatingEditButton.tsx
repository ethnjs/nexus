"use client";

import Link from "next/link";
import { IconEdit } from "@/components/ui/Icons";
import styles from "./FloatingEditButton.module.css";

interface FloatingEditButtonProps {
  /** Where editing happens — this page's own edit route. */
  href: string;
  title?: string;
}

// The "edit what you're looking at" affordance for a whole page, as opposed
// to a control for one field: a record you read top to bottom has no single
// place a header button belongs, so it sits over the page instead.
export function FloatingEditButton({ href, title = "Edit" }: FloatingEditButtonProps) {
  return (
    <Link href={href} title={title} aria-label={title} className={styles.button}>
      <IconEdit size={20} />
    </Link>
  );
}
