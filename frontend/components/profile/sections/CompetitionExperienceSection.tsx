import { SectionHeading } from "@/components/profile/SectionHeading";
import {
  CompetitionExperienceSpreadsheet, CompetitionExperienceDraft, ExperienceTableMode,
  competitionExperienceToDraft,
} from "@/components/profile/ExperienceTables";
import { CanonicalEvent } from "@/lib/api";

interface CompetitionExperienceSectionUser {
  has_competition_experience: boolean | null;
  competition_experience: {
    id: number;
    event: { name: string; id: number };
    school: string;
    notes: string | null;
  }[];
}

interface CompetitionExperienceSectionProps {
  user: CompetitionExperienceSectionUser;
  mode?: ExperienceTableMode; // defaults to read-only "view"
  events?: CanonicalEvent[]; // required if mode is "view-edit"
  onAdd?: (row: CompetitionExperienceDraft) => Promise<CompetitionExperienceDraft>;
  onUpdate?: (id: number, row: CompetitionExperienceDraft) => Promise<CompetitionExperienceDraft>;
  onDelete?: (id: number) => Promise<void>;
}

export function CompetitionExperienceSection({
  user, mode = "view", events = [], onAdd, onUpdate, onDelete,
}: CompetitionExperienceSectionProps) {
  if (user.has_competition_experience === false) return null;

  const rows: CompetitionExperienceDraft[] = user.competition_experience.map((exp) =>
    competitionExperienceToDraft(exp as Parameters<typeof competitionExperienceToDraft>[0])
  );

  return (
    <SectionHeading title="Competition Experience">
      <CompetitionExperienceSpreadsheet
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