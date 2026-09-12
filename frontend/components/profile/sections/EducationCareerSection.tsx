import { SectionHeading } from "@/components/profile/SectionHeading";
import { FieldGrid, TextField } from "@/components/profile/PanelField";

interface EducationCareerUser {
  student_status: "Undergraduate" | "Graduate" | "Non-Student" | null;
  university: { name: string } | null;
  major: string | null;
  year_level: number | null;
  graduation_year: number | null;
  employer: string | null;
}

function formatYearLevel(year: number | null): string | null {
  if (year === null) return null;
  const suffix =
    year % 10 === 1 && year % 100 !== 11 ? "st" :
    year % 10 === 2 && year % 100 !== 12 ? "nd" :
    year % 10 === 3 && year % 100 !== 13 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export function EducationCareerSection({ user, hiddenFields }: {
  user: EducationCareerUser;
  /** Field ids the TD turned off — matches the backend's PANEL_SECTIONS entry for "education". */
  hiddenFields?: Set<string>;
}) {
  const shows = (field: string) => !hiddenFields?.has(field);
  const isCareer = user.student_status === "Non-Student";

  return (
    <SectionHeading title={isCareer ? "Career" : "Education"}>
      {user.student_status === null ? (
        <TextField label="Status" value={null} />
      ) : isCareer ? (
        shows("employer") ? <TextField label="Employer" value={user.employer} /> : null
      ) : (
        <FieldGrid>
          {shows("university") && <TextField label="University" value={user.university?.name ?? null} />}
          {shows("major") && <TextField label="Major" value={user.major} />}
          {shows("year_level") && <TextField label="Year Level" value={formatYearLevel(user.year_level)} />}
          {shows("graduation_year") && (
            <TextField label="Graduation Year" value={user.graduation_year !== null ? String(user.graduation_year) : null} />
          )}
        </FieldGrid>
      )}
    </SectionHeading>
  );
}
