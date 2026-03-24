"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/useAuth";
import { IconLogout } from "@/components/ui/Icons";

export function UserAvatar() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = user
    ? (`${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}`).toUpperCase() || user.email[0].toUpperCase()
    : "?";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "32px", height: "32px", borderRadius: "50%",
          background: "var(--color-accent)", color: "var(--color-text-inverse)",
          border: "none", fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 700,
          letterSpacing: "0.05em", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {initials}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, width: "220px",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)",
          overflow: "hidden", zIndex: 100,
        }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)" }}>
              {user?.first_name && user?.last_name
                ? `${user.first_name} ${user.last_name}`
                : user?.email}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
              {user?.email}
            </div>
            <div style={{ marginTop: "8px" }}>
              <span style={{
                fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.07em",
                color: "var(--color-text-secondary)", background: "var(--color-accent-subtle)",
                padding: "2px 7px", borderRadius: "var(--radius-sm)",
              }}>
                {user?.role}
              </span>
            </div>
          </div>
          <button
            onClick={() => { setOpen(false); logout(); }}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              width: "100%", padding: "11px 16px",
              border: "none", background: "transparent",
              fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
              color: "var(--color-danger)", cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-danger-subtle)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <IconLogout />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}