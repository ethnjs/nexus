"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconUser, IconShield } from "@/components/ui/Icons";

const NAV_ITEMS = [
  { href: "/settings/account",  icon: <IconUser size={15} />,   label: "Account" },
  { href: "/settings/security", icon: <IconShield size={15} />, label: "Security" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <aside style={{
      width: "220px", flexShrink: 0,
      padding: "32px 12px",
    }}>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        letterSpacing: "0.06em", textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
        padding: "0 10px", marginBottom: "8px",
      }}>
        Settings
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {NAV_ITEMS.map(({ href, icon, label }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                height: "34px", padding: "0 10px",
                borderRadius: "var(--radius-md)",
                fontFamily: "var(--font-sans)", fontSize: "13px",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                background: isActive ? "var(--color-accent-subtle)" : "transparent",
                textDecoration: "none",
                transition: "background var(--transition-fast), color var(--transition-fast)",
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--color-accent-subtle)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              {icon}
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
