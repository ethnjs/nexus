"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconUser, IconShield, IconMenu } from "@/components/ui/Icons";
import { useIsMobile } from "@/lib/useIsMobile";
import { SETTINGS_NAV_WIDTH, SETTINGS_CONTAINER_MAX_WIDTH } from "@/app/settings/constants";

const NAV_ITEMS = [
  { href: "/settings/account",  icon: <IconUser size={15} />,   label: "Account" },
  { href: "/settings/security", icon: <IconShield size={15} />, label: "Security" },
];

const TOPBAR_HEIGHT = 52;
const GAP = 16;

export function SettingsNav() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const asideStyle: React.CSSProperties = isMobile
    ? {
        width: `${SETTINGS_NAV_WIDTH}px`,
        position: "fixed",
        top: 0,
        left: 0,
        height: "100vh",
        boxSizing: "border-box",
        padding: "32px 12px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 0,
        boxShadow: "var(--shadow-lg)",
        transform: open ? "translateX(0)" : "translateX(-100%)",
        transition: "transform var(--transition-fast, 0.2s ease)",
        zIndex: 200,
      }
    : {
        width: `${SETTINGS_NAV_WIDTH}px`,
        position: "fixed",
        top: `${TOPBAR_HEIGHT + GAP}px`,
        left: `max(calc((100vw - ${SETTINGS_CONTAINER_MAX_WIDTH}px) / 2), 0px)`,
        height: `calc(100vh - ${TOPBAR_HEIGHT + GAP * 2}px)`,
        boxSizing: "border-box",
        padding: "32px 12px",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
      };

  return (
    <>
      {isMobile && (
        <button
          type="button"
          aria-label="Toggle settings menu"
          onClick={() => setOpen((o) => !o)}
          style={{
            position: "fixed", top: "8px", left: "12px", zIndex: 150,
            width: "36px", height: "36px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--color-surface)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-sm)",
            color: "var(--color-text-primary)", cursor: "pointer",
          }}
        >
          <IconMenu size={18} />
        </button>
      )}

      {isMobile && open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.4)", zIndex: 150 }}
        />
      )}

      <aside style={asideStyle}>
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
                onClick={() => setOpen(false)}
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
    </>
  );
}
