import { SectionHeading } from "@/components/profile/SectionHeading";
import {
  VolunteerExperienceSpreadsheet, VolunteerExperienceDraft, ExperienceTableMode,
  volunteerExperienceToDraft,
} from "@/components/profile/ExperienceTables";
import { CanonicalEvent } from "@/lib/api";

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
}

interface VolunteerExperienceSectionProps {
  user: VolunteerExperienceSectionUser;
  mode?: ExperienceTableMode;
  events?: CanonicalEvent[];
  onAdd?: (row: VolunteerExperienceDraft) => Promise<VolunteerExperienceDraft>;
  onUpdate?: (id: number, row: VolunteerExperienceDraft) => Promise<VolunteerExperienceDraft>;
  onDelete?: (id: number) => Promise<void>;
}

export function VolunteerExperienceSection({
  user, mode = "view", events = [], onAdd, onUpdate, onDelete,
}: VolunteerExperienceSectionProps) {
  if (user.has_volunteer_experience === false) return null;

  const rows: VolunteerExperienceDraft[] = user.volunteer_experience.map((exp) =>
    volunteerExperienceToDraft(exp as Parameters<typeof volunteerExperienceToDraft>[0])
  );

  return (
    <SectionHeading title="Volunteer Experience">
      <VolunteerExperienceSpreadsheet
        mode={mode}
        rows={rows}
        events={events}
        onAdd={onAdd}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </SectionHeading>
  );
}