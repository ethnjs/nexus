"use client";

import { startTransition, useEffect, useState } from "react";
import {
  ApiError, CanonicalEvent, DisplayConfigSection, MembershipFull, MembershipSlim, Role,
  TournamentShift, canonicalEventsApi, displayConfigApi, membershipsApi, tournamentShiftsApi,
} from "@/lib/api";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { EducationCareerSection } from "@/components/profile/sections/EducationCareerSection";
import { CompetitionExperienceSection } from "@/components/profile/sections/CompetitionExperienceSection";
import { VolunteerExperienceSection } from "@/components/profile/sections/VolunteerExperienceSection";
import { LogisticsSection } from "@/components/profile/sections/LogisticsSection";
import { AvailabilitySection } from "@/components/tournament/sections/AvailabilitySection";
import { LunchSection } from "@/components/tournament/sections/LunchSection";
import { EventPreferencesSection } from "@/components/tournament/sections/EventPreferencesSection";
import { CustomResponsesSection } from "@/components/tournament/sections/CustomResponsesSection";
import { MEMBERS_PANEL } from "@/lib/displayConfigSurfaces";
import { PanelSectionsModal } from "@/components/tournament/PanelSectionsModal";
import { Button } from "@/components/ui/Button";
import { IconEye } from "@/components/ui/Icons";
import {
  hiddenFieldsOf, isCustomSection, orderedSections, splitCustomAnswers,
} from "@/lib/panelSections";
import { MembershipSection } from "@/components/tournament/sections/MembershipSection";

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
  // Section order, per-section visibility, and the TD's custom sections.
  const [sectionConfig, setSectionConfig] = useState<DisplayConfigSection[] | null>(null);
  const [showSectionsModal, setShowSectionsModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // These usually resolve inside the ~220ms the panel spends sliding open,
  // and the commit they trigger swaps a spinner for the full section stack
  // (availability timeline, experience tables, logistics). As an urgent update
  // that render blocks the frame and visibly stutters the slide; marked as a
  // transition, React can slice it across frames and let the animation win.
  useEffect(() => {
    membershipsApi.get(tournamentId, membershipId, MEMBERS_PANEL)
      .then((data) => startTransition(() => setFull(data)))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load member."));
    canonicalEventsApi.list().then((data) => startTransition(() => setEvents(data))).catch(() => {});
    tournamentShiftsApi.list(tournamentId).then((data) => startTransition(() => setShifts(data))).catch(() => {});
    displayConfigApi.get(tournamentId)
      .then((config) => startTransition(() => setSectionConfig(config?.[MEMBERS_PANEL]?.sections ?? null)))
      .catch(() => {});
  }, [tournamentId, membershipId]);

  function handleRolesUpdated(updated: MembershipSlim) {
    setFull((f) => (f ? { ...f, roles: updated.roles } : f));
    onUpdated?.(updated);
  }

  const hiddenSections = new Set(full?.hidden_sections ?? []);

  // One renderer per section id. Ordering, visibility and per-field hiding
  // are all decided by the saved config above; this only says how a given
  // section draws itself.
  function renderSection(section: DisplayConfigSection) {
    if (!full) return null;
    // `hidden_sections` is a separate mechanism from `section.hidden`: the TD
    // turned a section off explicitly there, whereas this covers a section
    // whose every item was filtered away by the hidden-item list.
    if (hiddenSections.has(section.id)) return null;

    const hiddenFields = hiddenFieldsOf(section);
    const { assigned, unassigned } = splitCustomAnswers(
      full.custom_responses, orderedSections(sectionConfig),
    );

    if (isCustomSection(section.id)) {
      return (
        <CustomResponsesSection
          title={section.title || "Custom Responses"}
          customResponses={assigned.get(section.id) ?? []}
        />
      );
    }

    switch (section.id) {
      case "membership":
        return (
          <MembershipSection
            tournamentId={tournamentId}
            membership={full}
            allRoles={allRoles}
            canTouchRole={canTouchRole}
            locked={!canEditMember(full)}
            collectIsOver18={collectIsOver18}
            collectIsOver21={collectIsOver21}
            onRolesUpdated={handleRolesUpdated}
            hiddenFields={hiddenFields}
          />
        );
      case "availability":
        return <AvailabilitySection availability={full.availability} allShifts={shifts} />;
      case "lunch":
        return (
          // Lunch rows are filtered per category server-side; only the
          // dietary restriction is a static field of this section.
          <LunchSection
            lunch={full.lunch}
            dietaryRestriction={
              hiddenFields.has("dietary_restriction") ? null : full.user.dietary_restriction
            }
          />
        );
      case "event_preferences":
        return <EventPreferencesSection eventPreferences={full.event_preferences} />;
      case "custom_responses":
        // Whatever no custom section claimed — so an answer is never shown
        // twice, and never lost when its section is deleted.
        return <CustomResponsesSection customResponses={unassigned} />;
      case "education":
        return <ProfileCard><EducationCareerSection user={full.user} hiddenFields={hiddenFields} /></ProfileCard>;
      case "competition_experience":
        // Rendered whatever the data — the section itself distinguishes
        // "None" (answered, has none) from "No info yet" (never answered),
        // which an absent card can't.
        return (
          <ProfileCard>
            <CompetitionExperienceSection user={full.user} mode="view" events={events} />
          </ProfileCard>
        );
      case "volunteer_experience":
        return (
          <ProfileCard>
            <VolunteerExperienceSection user={full.user} mode="view" events={events} />
          </ProfileCard>
        );
      case "logistics":
        return <ProfileCard><LogisticsSection user={full.user} hiddenFields={hiddenFields} /></ProfileCard>;
      default:
        return null;
    }
  }

  return (
    <DockedPanel
      onClose={onClose}
      width={MEMBER_PANEL_WIDTH}
      onPrev={onPrev}
      onNext={onNext}
      prevDisabled={!hasPrev}
      nextDisabled={!hasNext}
      headerActions={
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Configure panel"
          onClick={() => setShowSectionsModal(true)}
        >
          <IconEye size={14} />
        </Button>
      }
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

            {orderedSections(sectionConfig).map((section) => (
              <div key={section.id}>{renderSection(section)}</div>
            ))}
          </>
        )}
      </div>
      {showSectionsModal && (
        <PanelSectionsModal
          tournamentId={tournamentId}
          onSaved={() =>
            displayConfigApi.get(tournamentId)
              .then((config) => setSectionConfig(config?.[MEMBERS_PANEL]?.sections ?? null))
              .catch(() => {})
          }
          onClose={() => setShowSectionsModal(false)}
        />
      )}
    </DockedPanel>
  );
}
