"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconUser, IconShield } from "@/components/ui/Icons";
import { useNavDrawer } from "@/lib/useNavDrawer";
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
 * corrects itself afterwards. The button that opens the drawer belongs to the
 * Topbar; this reads its state from NavDrawerProvider.
 */
export function SettingsNav() {
  const pathname = usePathname();
  // The toggle lives in the Topbar, so the open state is shared through a
  // context rather than held here. See lib/useNavDrawer.tsx.
  const { open, setOpen } = useNavDrawer();

  return (
    <>
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
