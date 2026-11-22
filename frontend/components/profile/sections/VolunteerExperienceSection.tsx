import {
  type ExperienceTableMode,
  type VolunteerExperienceDraft,
  VolunteerExperienceSpreadsheet,
  type VolunteerMembershipRow,
  volunteerExperienceToDraft,
} from "@/components/profile/ExperienceTables";
import { FieldValue } from "@/components/profile/PanelField";
import { SectionHeading } from "@/components/profile/SectionHeading";
import type { CanonicalEvent, UserTournamentMembership } from "@/lib/api";

interface VolunteerExperienceSectionUser {
  has_volunteer_experience: boolean | null;
  volunteer_experience: {
    id: number;
    tournament_name: string;
    role: string;
    year: number;
    event: { name: string; id: number } | null;
    notes: { event?: string; other?: string } | null;
  }[];
  // Absent where the response left the profile group out.
  tournament_memberships?: UserTournamentMembership[];
}

interface VolunteerExperienceSectionProps {
  user: VolunteerExperienceSectionUser;
  mode?: ExperienceTableMode;
  events?: CanonicalEvent[];
  onAdd?: (row: VolunteerExperienceDraft) => Promise<VolunteerExperienceDraft>;
  onUpdate?: (id: number, row: VolunteerExperienceDraft) => Promise<VolunteerExperienceDraft>;
  onDelete?: (id: number) => Promise<void>;
}

/** One row per tournament, its roles and events listed together. */
export function membershipRows(memberships: UserTournamentMembership[]): VolunteerMembershipRow[] {
  const joined = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => !!v))].join(", ");
  return memberships.map((m) => ({
    key: `m-${m.tournament_id}`,
    year: m.year === null ? "" : String(m.year),
    tournament_name: m.short_name || m.tournament_name,
    event_name: joined(m.assignments.map((a) => a.event)),
    role: joined(m.assignments.map((a) => a.role)),
  }));
}

export function VolunteerExperienceSection({
  user,
  mode = "view",
  events = [],
  onAdd,
  onUpdate,
  onDelete,
}: VolunteerExperienceSectionProps) {
  const rows: VolunteerExperienceDraft[] = user.volunteer_experience.map((exp) =>
    volunteerExperienceToDraft(exp as Parameters<typeof volunteerExperienceToDraft>[0]),
  );
  const fromMemberships = membershipRows(user.tournament_memberships ?? []);
  const saidNone = user.has_volunteer_experience === false;

  // The panel renders every section, so "they answered: none" and "they never
  // answered" have to read differently. Only in read-only mode: an editable
  // view still needs the table so a first row can be added.
  if (fromMemberships.length === 0) {
    if (mode === "view") {
      if (saidNone) {
        return (
          <SectionHeading title="Volunteer Experience">
            <FieldValue>None</FieldValue>
          </SectionHeading>
        );
      }
      if (rows.length === 0) {
        return (
          <SectionHeading title="Volunteer Experience">
            <FieldValue muted>No info yet</FieldValue>
          </SectionHeading>
        );
      }
    } else if (saidNone) {
      return null;
    }
  }

  return (
    <SectionHeading title="Volunteer Experience">
      <VolunteerExperienceSpreadsheet
        // Someone who said they have none gets nothing to add rows with.
        mode={saidNone ? "view" : mode}
        rows={rows}
        membershipRows={fromMemberships}
        events={events}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </SectionHeading>
  );
}
