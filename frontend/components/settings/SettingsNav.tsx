"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconUser, IconShield, IconMenu } from "@/components/ui/Icons";
import { Button } from "@/components/ui/Button";
import styles from "./Settings.module.css";

const NAV_ITEMS = [
  { href: "/settings/account",  icon: <IconUser size={15} />,   label: "Account" },
  { href: "/settings/security", icon: <IconShield size={15} />, label: "Security" },
];

function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/**
 * Settings side nav: a fixed panel on desktop, an off-canvas drawer behind a
 * scrim on mobile. Same arrangement as the app shell's rail (see
 * components/layout/Sidebar.tsx), and the switch is a media query for the same
 * reason — a JS viewport check renders desktop on the first frame and visibly
 * corrects itself afterwards.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Closes on navigation that didn't come from a nav row — a redirect, a link
  // elsewhere in the drawer — which wouldn't fire the row's onClick. Adjusted
  // during render rather than in an effect: React discards this pass and
  // re-renders immediately, with no extra paint in between.
  const [renderedPath, setRenderedPath] = useState(pathname);
  if (renderedPath !== pathname) {
    setRenderedPath(pathname);
    setOpen(false);
  }

  return (
    <>
      <div className={styles.toggle}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconOnly
          aria-label="Toggle settings menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <IconMenu size={14} />
        </Button>
      </div>

      <div
        onClick={() => setOpen(false)}
        className={cx(styles.scrim, open && styles.open)}
      />

      <aside className={cx(styles.nav, open && styles.open)}>
        <div className={styles.navTitle}>Settings</div>

        <nav className={styles.navList}>
          {NAV_ITEMS.map(({ href, icon, label }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cx(styles.navItem, isActive && styles.active)}
              >
                {icon}
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
