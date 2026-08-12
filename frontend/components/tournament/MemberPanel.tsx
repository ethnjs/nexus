"use client";

import { useEffect, useState } from "react";
import {
  ApiError, CanonicalEvent, MembershipFull, MembershipSlim, Role,
  canonicalEventsApi, membershipsApi,
} from "@/lib/api";
import { personName } from "@/lib/personDisplay";
import { SidePanel } from "@/components/ui/SidePanel";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { EducationCareerSection } from "@/components/profile/sections/EducationCareerSection";
import { CompetitionExperienceSection } from "@/components/profile/sections/CompetitionExperienceSection";
import { VolunteerExperienceSection } from "@/components/profile/sections/VolunteerExperienceSection";
import { LogisticsSection } from "@/components/profile/sections/LogisticsSection";
import { RolesCell } from "@/components/tournament/RolesCell";

const SOURCE_LABELS: Record<string, string> = {
  join_code: "Invite",
  public: "Public",
  manual: "Manual",
};

const STATUS_VARIANT: Record<string, "interested" | "confirmed"> = {
  interested: "interested",
  confirmed: "confirmed",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface MemberPanelProps {
  tournamentId: number;
  membershipId: number;
  allRoles: Role[];
  canAssignRole: (role: Role) => boolean;
  onClose: () => void;
  /** Bubbles role changes up so the caller's list stays in sync. */
  onUpdated?: (updated: MembershipSlim) => void;
}

// Read-only member detail panel — reuses the same profile section
// components as /profile/[id] (header, education, experience, logistics),
// plus the tournament-specific membership info those don't cover
// (status, join method, roles). Meant to be dropped into any tournament
// page that lists members (roster, event rosters, etc.) behind an
// "expand" action.
export function MemberPanel({ tournamentId, membershipId, allRoles, canAssignRole, onClose, onUpdated }: MemberPanelProps) {
  const [full, setFull] = useState<MembershipFull | null>(null);
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    membershipsApi.get(tournamentId, membershipId)
      .then(setFull)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load member."));
    canonicalEventsApi.list().then(setEvents).catch(() => {});
  }, [tournamentId, membershipId]);

  function handleRolesUpdated(updated: MembershipSlim) {
    setFull((f) => (f ? { ...f, roles: updated.roles } : f));
    onUpdated?.(updated);
  }

  return (
    <SidePanel onClose={onClose} width={700}>
      <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {error ? (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>
        ) : !full ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            <ProfileHeader user={full.user} />

            <ProfileCard>
              <h3 style={{
                fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
                color: "var(--color-text-primary)", marginBottom: "4px",
              }}>
                Membership
              </h3>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <div style={{
                    fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "var(--color-text-tertiary)", marginBottom: "5px",
                  }}>
                    Status
                  </div>
                  <Badge variant={STATUS_VARIANT[full.status] ?? "default"}>{full.status}</Badge>
                </div>
                <div>
                  <div style={{
                    fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "var(--color-text-tertiary)", marginBottom: "5px",
                  }}>
                    Joined
                  </div>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {fmtDate(full.created_at)}
                  </span>
                </div>
                <div>
                  <div style={{
                    fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "var(--color-text-tertiary)", marginBottom: "5px",
                  }}>
                    Join Method
                  </div>
                  {full.source === "join_code" && full.join_code ? (
                    <div>
                      <Badge variant="default">Invite</Badge>
                      <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
                        {full.join_code.label ?? "Invite"} · invited by {personName(full.join_code.creator)}
                      </p>
                    </div>
                  ) : (
                    <Badge variant="default">{SOURCE_LABELS[full.source] ?? full.source}</Badge>
                  )}
                </div>
              </div>

              <div>
                <div style={{
                  fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  color: "var(--color-text-tertiary)", marginBottom: "5px",
                }}>
                  Roles
                </div>
                <RolesCell
                  tournamentId={tournamentId}
                  membership={full}
                  allRoles={allRoles}
                  canAssignRole={canAssignRole}
                  onUpdated={handleRolesUpdated}
                />
              </div>
            </ProfileCard>

            <ProfileCard><EducationCareerSection user={full.user} /></ProfileCard>

            {full.user.has_competition_experience !== false && (
              <ProfileCard>
                <CompetitionExperienceSection user={full.user} mode="view" events={events} />
              </ProfileCard>
            )}

            {full.user.has_volunteer_experience !== false && (
              <ProfileCard>
                <VolunteerExperienceSection user={full.user} mode="view" events={events} />
              </ProfileCard>
            )}

            <ProfileCard><LogisticsSection user={full.user} /></ProfileCard>
          </>
        )}
      </div>
    </SidePanel>
  );
}
