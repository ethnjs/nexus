"use client";

import { useEffect, useState } from "react";
import { adminUsersApi, AdminUserFull, ApiError } from "@/lib/api";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import { EducationCareerSection } from "@/components/profile/sections/EducationCareerSection";
import { LogisticsSection } from "@/components/profile/sections/LogisticsSection";
import { CompetitionExperienceSection } from "@/components/profile/sections/CompetitionExperienceSection";
import { VolunteerExperienceSection } from "@/components/profile/sections/VolunteerExperienceSection";
import { IconExpand } from "@/components/ui/Icons";

// Exported so a caller registering this in the layout slot reserves exactly
// the width it renders at.
export const ADMIN_USER_PANEL_WIDTH = 620;

const STATUS_VARIANT = {
  active:      "confirmed",
  invited:     "pending",
  deactivated: "removed",
  locked:      "declined",
} as const;

/**
 * Read-only account detail, for any admin surface that names a user — the
 * users table, and a tournament's owner.
 *
 * Reuses the same profile sections as /profile/[id] rather than restating
 * them, and adds the account-level facts those don't carry (role, status,
 * email verification) since that is what an admin opened this for.
 */
export function AdminUserPanel({ userId, onClose }: { userId: number; onClose: () => void }) {
  const [user, setUser] = useState<AdminUserFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState(userId);

  // Adjust-state-during-render rather than an effect: switching users has to
  // drop the previous profile in the *same* render, or the new person's name
  // shows above the old person's details for a frame. Clearing it in an effect
  // would cost an extra render pass and paint that stale pairing first.
  if (loadedFor !== userId) {
    setLoadedFor(userId);
    setUser(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    adminUsersApi.get(userId)
      .then((u) => { if (!cancelled) setUser(u); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load this account.");
      });
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <DockedPanel
      width={ADMIN_USER_PANEL_WIDTH}
      onClose={onClose}
      headerActions={
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Open full profile"
          onClick={() => window.open(`/profile/${userId}`, "_blank", "noopener,noreferrer")}
        >
          <IconExpand size={13} />
        </Button>
      }
    >
      {error ? (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", padding: "20px" }}>
          {error}
        </p>
      ) : !user ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spinner />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px" }}>
          {/* Account state rides in the header beside the name — it's the
              reason an admin opened this rather than /profile/[id], and the
              shared profile sections don't carry any of it. */}
          <ProfileHeader
            user={user}
            badges={
              <>
                <Badge variant={user.role === "admin" ? "admin" : "default"}>
                  {user.role === "admin" ? "Admin" : "User"}
                </Badge>
                <Badge variant={STATUS_VARIANT[user.status]}>{user.status}</Badge>
                <Badge variant={user.email_verified ? "confirmed" : "warning"}>
                  {user.email_verified ? "Email verified" : "Email unverified"}
                </Badge>
              </>
            }
          />

          {/* One ProfileCard per section, same as /profile/[id] and MemberPanel —
              the sections render their heading and content only, and rely on a
              card around them for separation. */}
          <ProfileCard><EducationCareerSection user={user} /></ProfileCard>
          <ProfileCard><CompetitionExperienceSection user={user} /></ProfileCard>
          <ProfileCard><VolunteerExperienceSection user={user} /></ProfileCard>
          <ProfileCard><LogisticsSection user={user} /></ProfileCard>
        </div>
      )}
    </DockedPanel>
  );
}
