"use client";

import { ReactNode } from "react";
import {
  DisplayConfigSection, MembershipFull, MembershipView, Role, TournamentShift,
} from "@/lib/api";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { EducationCareerSection } from "@/components/profile/sections/EducationCareerSection";
import { CompetitionExperienceSection } from "@/components/profile/sections/CompetitionExperienceSection";
import { VolunteerExperienceSection } from "@/components/profile/sections/VolunteerExperienceSection";
import { LogisticsSection } from "@/components/profile/sections/LogisticsSection";
import { AvailabilitySection } from "@/components/tournament/sections/AvailabilitySection";
import { LunchSection } from "@/components/tournament/sections/LunchSection";
import { EventPreferencesSection } from "@/components/tournament/sections/EventPreferencesSection";
import { CustomResponsesSection } from "@/components/tournament/sections/CustomResponsesSection";
import { MembershipSection } from "@/components/tournament/sections/MembershipSection";
import {
  hiddenFieldsOf, isCustomSection, orderedSections, splitCustomAnswers,
} from "@/lib/panelSections";

export interface MemberSectionsProps {
  tournamentId: number;
  membership: MembershipView;
  /** Section order and per-section visibility. null = every section, in
      default order — what the member page passes, since it has no display
      config of its own. */
  sectionConfig: DisplayConfigSection[] | null;
  /** Every shift the tournament offers — sets the availability timeline's window. */
  shifts: TournamentShift[];
  allRoles: Role[];
  canTouchRole: (role: Role) => boolean;
  /** Role editing off. Not the same as "can't act on this member": someone
      viewing their own page passes canEditMember but still can't hand
      themselves a role. */
  rolesLocked: boolean;
  collectIsOver18: boolean;
  collectIsOver21: boolean;
  onRolesUpdated: (updated: MembershipFull) => void;
}

/**
 * The member record's section stack, shared by the docked panel and the full
 * member page.
 *
 * Everything under sections/ draws one section's contents; this is the layer
 * above them that says which sections exist and in what order. That's
 * entirely `sectionConfig`'s business — the panel passes the viewer's saved
 * config, the page passes null for "all of them" — so nothing here decides
 * visibility on its own.
 */
export function MemberSections(props: MemberSectionsProps) {
  const { membership, sectionConfig } = props;
  const sections = orderedSections(sectionConfig);
  // `hidden_sections` is a separate mechanism from `section.hidden`: the TD
  // turned a section off explicitly there, whereas this covers a section
  // whose every item was filtered away by the hidden-item list. Empty when
  // the caller fetched without a surface (the member page), since nothing
  // was filtered in the first place.
  const hiddenSections = new Set(membership.hidden_sections ?? []);
  // `unassigned` is only non-empty once the catch-all section is deleted,
  // which is a TD choosing for those answers not to show.
  const { assigned } = splitCustomAnswers(membership.custom_responses ?? [], sections);

  return (
    <>
      {sections.map((section) => {
        if (hiddenSections.has(section.id)) return null;
        const body = isCustomSection(section.id)
          ? (
            <CustomResponsesSection
              title={section.title || "Custom Responses"}
              customResponses={assigned.get(section.id) ?? []}
            />
          )
          : RENDERERS[section.id]?.(props, hiddenFieldsOf(section));
        return body ? <div key={section.id}>{body}</div> : null;
      })}
    </>
  );
}

// One entry per built-in section id. A table rather than a switch because
// every arm is the same shape — id in, one component out — and the ids are
// the same set the backend's PANEL_SECTIONS declares, so a missing entry
// should read as an obvious gap in a list.
const RENDERERS: Record<
  string,
  (props: MemberSectionsProps, hiddenFields: Set<string>) => ReactNode
> = {
  membership: (p, hiddenFields) => (
    <MembershipSection
      tournamentId={p.tournamentId}
      membership={p.membership}
      allRoles={p.allRoles}
      canTouchRole={p.canTouchRole}
      locked={p.rolesLocked}
      collectIsOver18={p.collectIsOver18}
      collectIsOver21={p.collectIsOver21}
      onRolesUpdated={p.onRolesUpdated}
      hiddenFields={hiddenFields}
    />
  ),
  availability: (p) => <AvailabilitySection availability={p.membership.availability ?? []} allShifts={p.shifts} />,
  // Lunch rows are filtered per category server-side; only the dietary
  // restriction is a static field of this section.
  lunch: (p, hiddenFields) => (
    <LunchSection
      lunch={p.membership.lunch ?? []}
      dietaryRestriction={
        hiddenFields.has("dietary_restriction") ? null : p.membership.user.dietary_restriction
      }
    />
  ),
  event_preferences: (p) => <EventPreferencesSection eventPreferences={p.membership.event_preferences ?? []} />,
  education: (p, hiddenFields) => (
    <ProfileCard><EducationCareerSection user={p.membership.user} hiddenFields={hiddenFields} /></ProfileCard>
  ),
  // The experience sections render whatever the data — each distinguishes
  // "None" (answered, has none) from "No info yet" (never answered), which
  // an absent card can't. No `events`: that's the picker catalog for
  // view-edit mode, and each row already carries its own resolved event.
  competition_experience: (p) => (
    <ProfileCard><CompetitionExperienceSection user={p.membership.user} mode="view" /></ProfileCard>
  ),
  volunteer_experience: (p) => (
    <ProfileCard><VolunteerExperienceSection user={p.membership.user} mode="view" /></ProfileCard>
  ),
  logistics: (p, hiddenFields) => (
    <ProfileCard><LogisticsSection user={p.membership.user} hiddenFields={hiddenFields} /></ProfileCard>
  ),
};
