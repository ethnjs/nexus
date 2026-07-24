import { CompetitionExperienceTableView, VolunteerExperienceTableView } from "@/components/profile/ExperienceTables";

interface CompetitionExperienceSectionUser {
  has_competition_experience: boolean | null;
  competition_experience: {
    id: number;
    event: { name: string };
    school: string;
    notes: string | null;
  }[];
}

export function CompetitionExperienceSection({ user }: { user: CompetitionExperienceSectionUser }) {
  if (user.has_competition_experience === false) return null;

  return (
    <div>
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "16px",
      }}>
        Competition Experience
      </h3>
      <CompetitionExperienceTableView rows={user.competition_experience} />
    </div>
  );
}

interface VolunteerExperienceSectionUser {
  has_volunteer_experience: boolean | null;
  volunteer_experience: {
    id: number;
    tournament_name: string;
    role: string;
    year: number;
    event: { name: string } | null;
    notes: { event?: string; other?: string } | null;
  }[];
}

export function VolunteerExperienceSection({ user }: { user: VolunteerExperienceSectionUser }) {
  if (user.has_volunteer_experience === false) return null;

  return (
    <div>
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "16px",
      }}>
        Volunteer Experience
      </h3>
      <VolunteerExperienceTableView rows={user.volunteer_experience} />
    </div>
  );
}