"use client";

import { useEffect, useState } from "react";
import {
  ApiError, CanonicalEvent, MembershipFull, MembershipSlim, Role, TournamentShift,
  canonicalEventsApi, membershipsApi, tournamentShiftsApi,
} from "@/lib/api";
import { formatDate } from "@/lib/timeFormat";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { EducationCareerSection } from "@/components/profile/sections/EducationCareerSection";
import { CompetitionExperienceSection } from "@/components/profile/sections/CompetitionExperienceSection";
import { VolunteerExperienceSection } from "@/components/profile/sections/VolunteerExperienceSection";
import { LogisticsSection } from "@/components/profile/sections/LogisticsSection";
import { RolesCell } from "@/components/tournament/RolesCell";
import { JoinMethodCell } from "@/components/tournament/JoinMethodCell";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue, FieldList, FieldGrid } from "@/components/profile/PanelField";
import { AgeFlagsBadges } from "@/components/tournament/sections/AgeFlagsBadges";
import { AvailabilitySection } from "@/components/tournament/sections/AvailabilitySection";
import { LunchSection } from "@/components/tournament/sections/LunchSection";
import { EventPreferencesSection } from "@/components/tournament/sections/EventPreferencesSection";
import { CustomResponsesSection } from "@/components/tournament/sections/CustomResponsesSection";
import { MEMBERS_PANEL } from "@/lib/displayConfigSurfaces";

// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const MEMBER_PANEL_WIDTH = 700;

interface MemberPanelProps {
  tournamentId: number;
  membershipId: number;
  allRoles: Role[];
  canTouchRole: (role: Role) => boolean;
  canEditMember: (target: MembershipSlim) => boolean;
  /** Tournament's age-disclosure toggles — the Age field is dropped entirely when neither is on, since there's nothing to show for any member. */
  collectIsOver18: boolean;
  collectIsOver21: boolean;
  onClose: () => void;
  /** Bubbles role changes up so the caller's list stays in sync. */
  onUpdated?: (updated: MembershipSlim) => void;
  /** Prev/next through the table's current filtered/sorted order — omit both to hide the controls (e.g. while this panel is showing one member of a multi-select). */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

// Read-only member detail panel — reuses the same profile section
// components as /profile/[id] (header, education, experience, logistics),
// plus the tournament-specific membership info those don't cover
// (status, join method, roles). Meant to be dropped into any tournament
// page that lists members (roster, event rosters, etc.) behind an
// "expand" action.
export function MemberPanel({
  tournamentId, membershipId, allRoles, canTouchRole, canEditMember,
  collectIsOver18, collectIsOver21, onClose, onUpdated,
  onPrev, onNext, hasPrev, hasNext,
}: MemberPanelProps) {
  const [full, setFull] = useState<MembershipFull | null>(null);
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  // Sets the availability timeline's window — without it the bar can only
  // show gaps between the member's own shifts, never hours they declined.
  const [shifts, setShifts] = useState<TournamentShift[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    membershipsApi.get(tournamentId, membershipId, MEMBERS_PANEL)
      .then(setFull)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load member."));
    canonicalEventsApi.list().then(setEvents).catch(() => {});
    tournamentShiftsApi.list(tournamentId).then(setShifts).catch(() => {});
  }, [tournamentId, membershipId]);

  function handleRolesUpdated(updated: MembershipSlim) {
    setFull((f) => (f ? { ...f, roles: updated.roles } : f));
    onUpdated?.(updated);
  }

  return (
    <DockedPanel
      onClose={onClose}
      width={MEMBER_PANEL_WIDTH}
      onPrev={onPrev}
      onNext={onNext}
      prevDisabled={!hasPrev}
      nextDisabled={!hasNext}
    >
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
              <SectionHeading title="Membership">
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <FieldGrid>
                    <PanelField label="Joined">
                      <FieldValue>{formatDate(full.created_at)}</FieldValue>
                    </PanelField>
                    <PanelField label="Join Method">
                      <JoinMethodCell membership={full} />
                    </PanelField>
                  </FieldGrid>

                  <FieldGrid>
                    {full.track_statuses.length > 0 && (
                      <PanelField label="Tracks">
                        <FieldList>
                          {full.track_statuses.map((ts) => (
                            // An archived track's statuses stay readable — the
                            // catalog entry is retired, the commitment still
                            // happened — so it's dimmed rather than hidden.
                            <div
                              key={ts.track_id}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                                opacity: ts.is_archived ? 0.55 : undefined,
                              }}
                              title={ts.is_archived ? "Archived track" : undefined}
                            >
                              <FieldValue>{ts.name}</FieldValue>
                              <Badge variant={ts.status}>{ts.status}</Badge>
                            </div>
                          ))}
                        </FieldList>
                      </PanelField>
                    )}

                    <PanelField label="Roles">
                      <RolesCell
                        tournamentId={tournamentId}
                        membership={full}
                        allRoles={allRoles}
                        canTouchRole={canTouchRole}
                        locked={!canEditMember(full)}
                        onUpdated={handleRolesUpdated}
                      />
                    </PanelField>
                  </FieldGrid>

                  {(collectIsOver18 || collectIsOver21) && (
                    <FieldGrid>
                      <PanelField label="Age">
                        <AgeFlagsBadges isOver18={full.is_over_18} isOver21={full.is_over_21} />
                      </PanelField>
                    </FieldGrid>
                  )}
                </div>
              </SectionHeading>
            </ProfileCard>

            <AvailabilitySection availability={full.availability} allShifts={shifts} />
            <LunchSection lunch={full.lunch} />
            <EventPreferencesSection eventPreferences={full.event_preferences} />
            <CustomResponsesSection customResponses={full.custom_responses} />

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
    </DockedPanel>
  );
}
