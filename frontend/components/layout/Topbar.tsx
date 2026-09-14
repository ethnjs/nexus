"use client";

import { UserAvatar } from "@/components/ui/UserAvatar";
import { TournamentDropdown } from "@/components/layout/TournamentDropdown";
import { COLLAPSED_W, EXPANDED_W } from "@/components/layout/Sidebar";
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
   * Reserve room at the left for a fixed-position drawer toggle rendered
   * outside the Topbar but overlapping its top-left corner. Mobile-only, and
   * applied in CSS so it's correct on the first painted frame.
   */
  clearsMobileToggle?: boolean;
}

export function Topbar({
  showWordmark = false,
  showDropdown = false,
  showAvatar = true,
  tournamentId,
  sidebarExpanded = false,
  clearsMobileToggle = false,
}: TopbarProps) {
  const className = [styles.topbar, clearsMobileToggle && styles.clearsToggle]
    .filter(Boolean)
    .join(" ");

  return (
    <header
      className={className}
      style={{
        // Only the hover-driven part stays inline — it's interaction state,
        // which can't exist before hydration. The rest is in the stylesheet.
        ["--sidebar-offset" as string]: sidebarExpanded ? `${EXPANDED_W - COLLAPSED_W}px` : "0px",
      }}
    >
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
