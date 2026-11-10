import type { ReactNode } from "react";
import { GridWarp } from "@/components/home/GridWarp";
import styles from "@/components/layout/CenteredCard.module.css";

/** The signed-out page: the home grid behind a card headed by the wordmark. */
export function AuthShell({
  children,
  wide = false,
  backLink,
  footer,
}: {
  children: ReactNode;
  wide?: boolean;
  /** Pinned to the page's top-left corner, outside the card. */
  backLink?: ReactNode;
  /** Under the card, on the grid. */
  footer?: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <div className={styles.authGrid} aria-hidden>
        {/* --color-border: lighter than the home page's lines, which have only a
            wordmark to compete with rather than a form. */}
        <GridWarp lineColor={0xe2e2de} />
      </div>
      {backLink}
      <div className={`${styles.authStack} ${wide ? styles.authStackWide : ""}`}>
        <section className={`${styles.card} ${styles.authCard}`}>
          <h1 className={`${styles.wordmark} ${styles.wordmarkCompact}`}>NEXUS</h1>
          {children}
        </section>
        {footer}
      </div>
    </div>
  );
}
