"use client";

import { UserAvatar } from "@/components/ui/UserAvatar";
import { TournamentDropdown } from "@/components/layout/TournamentDropdown";
import { COLLAPSED_W, EXPANDED_W } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/Button";
import { IconMenu } from "@/components/ui/Icons";
import { useNavDrawer } from "@/lib/useNavDrawer";
import styles from "./Topbar.module.css";

// Shared with DockedPanel so its own header strip lines up exactly with
// Topbar's bottom border, reading as one continuous bar across both.
export const TOPBAR_HEIGHT = 52;

interface TopbarProps {
  /**
   * `true` shows the wordmark at every width. `"mobile-only"` is for the app
   * shells, where the rail carries it on desktop but is an off-canvas drawer
   * on mobile — the bar takes over there.
   */
  showWordmark?: boolean | "mobile-only";
  showDropdown?: boolean;
  /**
   * `"logout-only"` shows the avatar but limits its menu to Sign out — for
   * onboarding, where Profile and Settings both redirect straight back.
   */
  showAvatar?: boolean | "logout-only";
  tournamentId?: string | number;
  sidebarExpanded?: boolean;
  /**
   * Render the mobile nav drawer's toggle as the bar's first item. Needs a
   * NavDrawerProvider above this Topbar and the drawer it controls.
   */
  showNavToggle?: boolean;
}

export function Topbar({
  showWordmark = false,
  showDropdown = false,
  showAvatar = true,
  tournamentId,
  sidebarExpanded = false,
  showNavToggle = false,
}: TopbarProps) {
  const { open, setOpen } = useNavDrawer();

  return (
    <header
      className={styles.topbar}
      style={{
        // Only the hover-driven part stays inline — it's interaction state,
        // which can't exist before hydration. The rest is in the stylesheet.
        ["--sidebar-offset" as string]: sidebarExpanded ? `${EXPANDED_W - COLLAPSED_W}px` : "0px",
      }}
    >
      {/* In the bar's normal flow, not a fixed overlay — see NavDrawerProvider
          for why. Hidden on desktop, where the rail expands on hover. */}
      {showNavToggle && (
        <span className={styles.navToggle}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            iconOnly
            aria-label="Toggle navigation menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <IconMenu size={14} />
          </Button>
        </span>
      )}

      {showWordmark && (
        <a
          href="/dashboard"
          className={[styles.wordmark, showWordmark === "mobile-only" && styles.wordmarkMobileOnly]
            .filter(Boolean)
            .join(" ")}
        >
          NEXUS
        </a>
      )}

      {showDropdown && (
        <div className={styles.dropdownSlot}>
          <TournamentDropdown tournamentId={tournamentId} />
        </div>
      )}

      <div style={{ flex: 1 }} />

      {showAvatar && <UserAvatar logoutOnly={showAvatar === "logout-only"} />}
    </header>
  );
}
