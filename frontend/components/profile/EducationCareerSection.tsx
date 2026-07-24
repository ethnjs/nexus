interface EducationCareerUser {
  student_status: "Undergraduate" | "Graduate" | "Non-Student" | null;
  university: string | null;
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

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.06em",
        color: "var(--color-text-tertiary)", marginBottom: "3px",
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500,
        color: value !== null ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
      }}>
        {value !== null ? value : "No info yet"}
      </div>
    </div>
  );
}

export function EducationCareerSection({ user }: { user: EducationCareerUser }) {
  const isCareer = user.student_status === "Non-Student";
  const title = isCareer ? "Career" : "Education";

  return (
    <div>
      <h3 style={{
        fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
        color: "var(--color-text-primary)", marginBottom: "16px",
      }}>
        {title}
      </h3>

      {user.student_status === null ? (
        <Field label="Status" value={null} />
      ) : isCareer ? (
        <Field label="Employer" value={user.employer} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <Field label="University" value={user.university} />
          <Field label="Major" value={user.major} />
          <Field label="Year Level" value={formatYearLevel(user.year_level)} />
          <Field label="Graduation Year" value={user.graduation_year !== null ? String(user.graduation_year) : null} />
        </div>
      )}
    </div>
  );
}