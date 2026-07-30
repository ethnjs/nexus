"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import {
  usersApi, canonicalEventsApi, CanonicalEvent,
  STUDENT_STATUS, SHIRT_SIZE, UserMeFull, ApiError,
} from "@/lib/api";
import { validatePhone, validateDateOfBirth, formatPhone } from "@/lib/auth";
import { useFormattedInputChange } from "@/lib/useFormattedInput";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { ProfileQuestion } from "@/components/profile/ProfileQuestion";
import {
  PronounsField, StudentStatusField,
  UniversityField, MajorField, YearLevelField, GraduationYearField,
  EmployerField, YesNoField, ShirtSizeField, DietaryRestrictionField,
} from "@/components/profile/ProfileFields";
import {
  CompetitionExperienceSpreadsheet, CompetitionExperienceDraft, isCompetitionRowValid,
  competitionExperienceToDraft,
  VolunteerExperienceSpreadsheet, VolunteerExperienceDraft, isVolunteerRowValid,
  volunteerExperienceToDraft,
} from "@/components/profile/ExperienceTables";

const STATE = {
  NAME: 1,
  PHONE: 2,
  DATE_OF_BIRTH: 3,
  PRONOUNS: 4,
  STUDENT_STATUS: 5,
  UNIVERSITY: 6,
  EMPLOYER: 7,
  COMPETED_BEFORE: 8,
  COMPETITION_EXP: 9,
  VOLUNTEERED_BEFORE: 10,
  VOLUNTEERING_EXP: 11,
  SHIRT_SIZE: 12,
  DIETARY_RESTRICTIONS: 13,
  DIETARY_TEXT: 14,
  COMPLETE: 15,
} as const;

interface ProfileDraft {
  date_of_birth?: string;
  pronouns?: string;
  student_status?: STUDENT_STATUS;
  university?: string;
  major?: string;
  year_level?: number;
  graduation_year?: number;
  employer?: string;
  has_competition_experience?: boolean;
  has_volunteer_experience?: boolean;
  shirt_size?: SHIRT_SIZE;
  dietary_restriction?: string;
}

export default function OnboardingPage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [original, setOriginal] = useState<UserMeFull | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [state, setState] = useState<number>(STATE.NAME);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState<{ first: string; last: string }>({ first: "", last: "" });
  const [phone, setPhone] = useState("");
  const handlePhoneChange = useFormattedInputChange(
    phone, setPhone, formatPhone, (v) => v.replace(/\D/g, "").slice(0, 10),
  );

  const [profileData, setProfileData] = useState<ProfileDraft>({});
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  const [competitionRows, setCompetitionRows] = useState<CompetitionExperienceDraft[]>([]);
  const [volunteerRows, setVolunteerRows] = useState<VolunteerExperienceDraft[]>([]);
  const [hasDietary, setHasDietary] = useState<boolean | null>(null);

  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (authLoading) return;

    if (!currentUser) {
      router.replace("/");
      return;
    }

    if (currentUser.is_onboarding_complete) {
      router.replace("/dashboard");
      return;
    }

    usersApi.meFull()
      .then((user) => {
        setOriginal(user);
        setName({ first: user.first_name ?? "", last: user.last_name ?? "" });
        setPhone(user.phone ?? "");
        setProfileData({
          date_of_birth: user.date_of_birth ?? undefined,
          pronouns: user.pronouns ?? undefined,
          student_status: user.student_status ?? undefined,
          university: user.university ?? undefined,
          major: user.major ?? undefined,
          year_level: user.year_level ?? undefined,
          graduation_year: user.graduation_year ?? undefined,
          employer: user.employer ?? undefined,
          has_competition_experience: user.has_competition_experience ?? undefined,
          has_volunteer_experience: user.has_volunteer_experience ?? undefined,
          shirt_size: user.shirt_size ?? undefined,
          dietary_restriction: user.dietary_restriction ?? undefined,
        });
        setHasDietary(user.dietary_restriction !== null ? true : null);
        setCompetitionRows(user.competition_experience.map(competitionExperienceToDraft));
        setVolunteerRows(user.volunteer_experience.map(volunteerExperienceToDraft));
      })
      .catch(() => setLoadError("Failed to load your account."));

    canonicalEventsApi.list().then(setEvents).catch(() => {});
  }, [authLoading, currentUser, router]);

  function diffRows<T extends { id?: number }>(originalRows: T[], currentRows: T[]) {
    const originalIds = new Set(originalRows.filter(r => r.id !== undefined).map(r => r.id));
    const currentIds = new Set(currentRows.filter(r => r.id !== undefined).map(r => r.id));

    const toAdd = currentRows.filter(r => r.id === undefined);
    const toDelete = originalRows.filter(r => r.id !== undefined && !currentIds.has(r.id));
    const toUpdate = currentRows.filter(r => {
      if (r.id === undefined || !originalIds.has(r.id)) return false;
      const orig = originalRows.find(o => o.id === r.id);
      return JSON.stringify(orig) !== JSON.stringify(r);
    });

    return { toAdd, toUpdate, toDelete };
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!original) return;
    setLoading(true);
    setErrors({});

    const cleaned: Record<string, unknown> = {
      first_name: name.first,
      last_name: name.last,
      phone,
      ...profileData,
    };

    if (cleaned.student_status === "Undergraduate" || cleaned.student_status === "Graduate") {
      cleaned.employer = undefined;
    } else if (cleaned.student_status === "Non-Student") {
      cleaned.university = cleaned.major = cleaned.year_level = cleaned.graduation_year = undefined;
    } else {
      cleaned.student_status = cleaned.employer = cleaned.university = cleaned.major = cleaned.year_level = cleaned.graduation_year = undefined;
    }

    for (const key of Object.keys(cleaned)) {
      if (cleaned[key] === "") cleaned[key] = undefined;
    }

    try {
      await usersApi.updateMe(cleaned);

      if (profileData.has_competition_experience) {
        const compDiff = diffRows(original.competition_experience.map(competitionExperienceToDraft), competitionRows);
        await Promise.all([
          ...compDiff.toAdd.map(row => usersApi.addCompetitionExperience({
            event_id: row.event_id as number, school: row.school, notes: row.notes || null,
          })),
          ...compDiff.toUpdate.map(row => usersApi.updateCompetitionExperience(row.id as number, {
            event_id: row.event_id as number, school: row.school, notes: row.notes || null,
          })),
          ...compDiff.toDelete.map(row => usersApi.deleteCompetitionExperience(row.id as number)),
        ]);
      }

      if (profileData.has_volunteer_experience) {
        function volunteerBody(row: VolunteerExperienceDraft) {
          const hasCustomEvent = row.event_id === null && row.event_name.trim();
          const hasNotesOther = row.notes_other.trim();
          return {
            tournament_name: row.tournament_name,
            year: Number(row.year),
            role: row.role,
            event_id: row.event_id ?? undefined,
            notes: hasCustomEvent || hasNotesOther
              ? {
                  ...(hasCustomEvent ? { event: row.event_name.trim() } : {}),
                  ...(hasNotesOther ? { other: row.notes_other.trim() } : {}),
                }
              : undefined,
          };
        }
        const volDiff = diffRows(original.volunteer_experience.map(volunteerExperienceToDraft), volunteerRows);
        await Promise.all([
          ...volDiff.toAdd.map(row => usersApi.addVolunteerExperience(volunteerBody(row))),
          ...volDiff.toUpdate.map(row => usersApi.updateVolunteerExperience(row.id as number, volunteerBody(row))),
          ...volDiff.toDelete.map(row => usersApi.deleteVolunteerExperience(row.id as number)),
        ]);
      }

      window.location.href = "/dashboard";
    } catch (error: unknown) {
      setErrors({ form: error instanceof ApiError ? error.message : "Something went wrong. Try again." });
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || (!original && !loadError)) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError || !original) {
    return (
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
        {loadError ?? "Something went wrong."}
      </p>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", paddingBottom: "100px" }}>
      <div style={{
        maxWidth: "700px", margin: "0 auto", padding: "40px 20px",
        display: "flex", flexDirection: "column", gap: "5px",
      }}>
        <div style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sm)",
          padding: "32px",
        }}>
          <div style={{
            fontFamily: "Georgia, serif", fontSize: "15px",
            letterSpacing: "0.18em", textTransform: "uppercase",
            color: "var(--color-text-primary)", userSelect: "none",
            marginBottom: "5px",
          }}>
            NEXUS
          </div>
          <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            Complete Your Profile
          </h1>
        </div>

        <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <ProfileCard>
            <ProfileQuestion
              question="What is your name?"
              onNext={() => {
                const ers: Record<string, string | undefined> = {};
                if (!name.first.trim()) ers.first_name = "Cannot be empty.";
                if (!name.last.trim()) ers.last_name = "Cannot be empty.";
                if (Object.keys(ers).length > 0) {
                  setErrors((er) => ({ ...er, ...ers }));
                  return;
                }
                setState(STATE.PHONE);
              }}
              isActive={state === STATE.NAME}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <Input
                  label="First Name"
                  type="text"
                  value={name.first}
                  onChange={(e) => { setName((n) => ({ ...n, first: e.target.value })); setErrors((er) => ({ ...er, first_name: undefined })); }}
                  autoComplete="given-name"
                  error={errors.first_name}
                  fullWidth
                />
                <Input
                  label="Last Name"
                  type="text"
                  value={name.last}
                  onChange={(e) => { setName((n) => ({ ...n, last: e.target.value })); setErrors((er) => ({ ...er, last_name: undefined })); }}
                  autoComplete="family-name"
                  error={errors.last_name}
                  fullWidth
                />
              </div>
            </ProfileQuestion>
          </ProfileCard>

          {state >= STATE.PHONE && (
            <ProfileCard>
              <ProfileQuestion
                question="What is your phone number?"
                onNext={() => {
                  const err = validatePhone(phone);
                  if (err) {
                    setErrors((er) => ({ ...er, phone: err }));
                    return;
                  }
                  setState(STATE.DATE_OF_BIRTH);
                }}
                isActive={state === STATE.PHONE}
              >
                <Input
                  type="tel"
                  value={formatPhone(phone)}
                  onChange={(e) => { handlePhoneChange(e); setErrors((er) => ({ ...er, phone: undefined })); }}
                  autoComplete="tel"
                  error={errors.phone}
                  fullWidth
                />
              </ProfileQuestion>
            </ProfileCard>
          )}

          {state >= STATE.DATE_OF_BIRTH && (
            <ProfileCard>
              <ProfileQuestion
                question="What is your date of birth?"
                onNext={() => {
                  const err = validateDateOfBirth(profileData.date_of_birth ?? "");
                  if (err) {
                    setErrors((er) => ({ ...er, date_of_birth: err }));
                    return;
                  }
                  setState(STATE.PRONOUNS);
                }}
                isActive={state === STATE.DATE_OF_BIRTH}
              >
                <Input
                  type="date"
                  value={profileData.date_of_birth ?? ""}
                  onChange={(e) => {
                    setProfileData((d) => ({ ...d, date_of_birth: e.target.value }));
                    setErrors((er) => ({ ...er, date_of_birth: undefined }));
                  }}
                  error={errors.date_of_birth}
                  fullWidth
                />
              </ProfileQuestion>
            </ProfileCard>
          )}

          {state >= STATE.PRONOUNS && (
            <ProfileCard>
              <ProfileQuestion
                question="What are your pronouns?"
                onSkip={() => setState(STATE.STUDENT_STATUS)}
                onNext={() => {
                  if (!profileData.pronouns?.trim()) {
                    setErrors((er) => ({ ...er, pronouns: "Cannot be empty." }));
                    return;
                  }
                  setState(STATE.STUDENT_STATUS);
                }}
                isActive={state === STATE.PRONOUNS}
              >
                <PronounsField
                  value={profileData.pronouns ?? ""}
                  error={errors.pronouns}
                  onChange={(v) => {
                    setProfileData((d) => ({ ...d, pronouns: v }));
                    setErrors((er) => ({ ...er, pronouns: undefined }));
                  }}
                />
              </ProfileQuestion>
            </ProfileCard>
          )}

          {state >= STATE.STUDENT_STATUS && (
            <ProfileCard>
              <ProfileQuestion
                question="What is your student status?"
                onSkip={() => setState(STATE.STUDENT_STATUS + 3)}
                isActive={state === STATE.STUDENT_STATUS}
              >
                <StudentStatusField
                  value={profileData.student_status}
                  onChange={(v) => {
                    setProfileData((d) => ({ ...d, student_status: v }));
                    if (state >= STATE.STUDENT_STATUS + 3) return;
                    if (v === "Undergraduate" || v === "Graduate") {
                      setState(STATE.UNIVERSITY);
                    } else if (v === "Non-Student") {
                      setState(STATE.EMPLOYER);
                    }
                  }}
                />
              </ProfileQuestion>
              
              {state >= STATE.UNIVERSITY && (profileData.student_status === "Undergraduate" || profileData.student_status === "Graduate") && (
                <>
                  <ProfileQuestion question="What university do you attend?">
                    <UniversityField
                      value={profileData.university}
                      error={errors.university}
                      onChange={(v) => {
                        setProfileData((d) => ({ ...d, university: v }));
                        setErrors((er) => ({ ...er, university: undefined }));
                      }}
                    />
                  </ProfileQuestion>
                  <ProfileQuestion question="What is your major?">
                    <MajorField
                      value={profileData.major}
                      error={errors.major}
                      onChange={(v) => {
                        setProfileData((d) => ({ ...d, major: v }));
                        setErrors((er) => ({ ...er, major: undefined }));
                      }}
                    />
                  </ProfileQuestion>
                  <ProfileQuestion question="What is your grade level?">
                    <YearLevelField
                      value={profileData.year_level}
                      error={errors.year_level}
                      onChange={(v) => {
                        setProfileData((d) => ({ ...d, year_level: v }));
                        setErrors((er) => ({ ...er, year_level: undefined }));
                      }}
                    />
                  </ProfileQuestion>
                  <ProfileQuestion
                    question="What is your projected graduation year?"
                    onSkip={() => {
                      setProfileData((d) => ({ ...d, university: undefined, major: undefined, year_level: undefined, graduation_year: undefined }));
                      setState(STATE.UNIVERSITY + 2);
                    }}
                    onNext={() => {
                      const ers: typeof errors = {};

                      if (!profileData.university) ers.university = "Cannot be empty.";
                      if (!profileData.major) ers.major = "Cannot be empty.";
                      if (!profileData.year_level) ers.year_level = "Cannot be empty.";

                      if (!profileData.graduation_year) ers.graduation_year = "Cannot be empty.";
                      else if (profileData.graduation_year < 1000 || profileData.graduation_year > 9999)
                        ers.graduation_year = "Must be a valid year.";

                      Object.keys(ers).length > 0 ? setErrors((er) => ({ ...er, ...ers })) : setState(STATE.UNIVERSITY + 2);
                    }}
                    isActive={state === STATE.UNIVERSITY}
                  >
                    <GraduationYearField
                      value={profileData.graduation_year}
                      error={errors.graduation_year}
                      onValidate={(err) => setErrors((er) => ({ ...er, graduation_year: err }))}
                      onChange={(v) => setProfileData((d) => ({ ...d, graduation_year: v }))}
                    />
                  </ProfileQuestion>
                </>
              )}
              
              {state >= STATE.EMPLOYER && profileData.student_status === "Non-Student" && (
                <ProfileQuestion
                  question="Who is your employer?"
                  onSkip={() => setState(STATE.COMPETED_BEFORE)}
                  onNext={() => {
                    !profileData.employer ? setErrors((er) => ({ ...er, employer: "Cannot be empty." })) : setState(STATE.COMPETED_BEFORE);
                  }}
                  isActive={state === STATE.EMPLOYER}
                >
                  <EmployerField
                    value={profileData.employer}
                    error={errors.employer}
                    onChange={(v) => {
                      setProfileData((d) => ({ ...d, employer: v }));
                      setErrors((er) => ({ ...er, employer: undefined }));
                    }}
                  />
                </ProfileQuestion>
              )}
            </ProfileCard>
          )}

          {state >= STATE.COMPETED_BEFORE && (
            <ProfileCard>
              <ProfileQuestion
                question="Have you competed in Science Olympiad before?"
                onSkip={() => setState(STATE.COMPETED_BEFORE + 2)}
                isActive={state === STATE.COMPETED_BEFORE}
              >
                <YesNoField
                  name="competed"
                  value={profileData.has_competition_experience ?? null}
                  onChange={(val) => {
                    setProfileData((d) => ({ ...d, has_competition_experience: val }));
                    if (state >= STATE.COMPETED_BEFORE + 2) return;
                    setState(val ? STATE.COMPETITION_EXP : STATE.COMPETED_BEFORE + 2);
                  }}
                />
              </ProfileQuestion>

              {state >= STATE.COMPETITION_EXP && profileData.has_competition_experience && (
                <ProfileQuestion
                  question="Add your competition experience."
                  onSkip={() => {
                    setProfileData((d) => ({ ...d, has_competition_experience: undefined }));
                    setCompetitionRows([]);
                    setState(STATE.VOLUNTEERED_BEFORE);
                  }}
                  onNext={() => {
                    if (competitionRows.length === 0 || !competitionRows.every(isCompetitionRowValid)) {
                      setErrors((er) => ({ ...er, competition_exp: "Each entry needs a school and a matched event." }));
                      return;
                    }
                    setState(STATE.VOLUNTEERED_BEFORE);
                  }}
                  isActive={state === STATE.COMPETITION_EXP}
                >
                  <CompetitionExperienceSpreadsheet mode="edit" rows={competitionRows} onChange={setCompetitionRows} events={events} />
                  {errors.competition_exp && (
                    <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginTop: "6px" }}>
                      {errors.competition_exp}
                    </p>
                  )}
                </ProfileQuestion>
              )}
            </ProfileCard>
          )}

          {state >= STATE.VOLUNTEERED_BEFORE && (
            <ProfileCard>
              <ProfileQuestion
                question="Have you volunteered for Science Olympiad before?"
                onSkip={() => setState(STATE.SHIRT_SIZE)}
                isActive={state === STATE.VOLUNTEERED_BEFORE}
              >
                <YesNoField
                  name="volunteered"
                  value={profileData.has_volunteer_experience ?? null}
                  onChange={(val) => {
                    setProfileData((d) => ({ ...d, has_volunteer_experience: val }));
                    if (state >= STATE.SHIRT_SIZE) return;
                    setState(val ? STATE.VOLUNTEERING_EXP : STATE.SHIRT_SIZE);
                  }}
                />
              </ProfileQuestion>

              {state >= STATE.VOLUNTEERING_EXP && profileData.has_volunteer_experience && (
                <ProfileQuestion
                  question="Add your volunteer experience."
                  onSkip={() => {
                    setProfileData((d) => ({ ...d, has_volunteer_experience: undefined }));
                    setVolunteerRows([]);
                    setState(STATE.SHIRT_SIZE);
                  }}
                  onNext={() => {
                    if (volunteerRows.length === 0 || !volunteerRows.every(isVolunteerRowValid)) {
                      setErrors((er) => ({ ...er, volunteering_exp: "Each entry needs a tournament name, a 4-digit year, and a role." }));
                      return;
                    }
                    setState(STATE.SHIRT_SIZE);
                  }}
                  isActive={state === STATE.VOLUNTEERING_EXP}
                >
                  <VolunteerExperienceSpreadsheet mode="edit" rows={volunteerRows} onChange={setVolunteerRows} events={events} />
                  {errors.volunteering_exp && (
                    <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginTop: "6px" }}>
                      {errors.volunteering_exp}
                    </p>
                  )}
                </ProfileQuestion>
              )}
            </ProfileCard>
          )}

          {state >= STATE.SHIRT_SIZE && (
            <ProfileCard>
              <ProfileQuestion
                question="What is your shirt size?"
                onSkip={() => {
                  setProfileData((d) => ({ ...d, shirt_size: undefined }));
                  setState(STATE.DIETARY_RESTRICTIONS);
                }}
                isActive={state === STATE.SHIRT_SIZE}
              >
                <ShirtSizeField
                  value={profileData.shirt_size}
                  onChange={(v) => {
                    setProfileData((d) => ({ ...d, shirt_size: v }));
                    if (state === STATE.SHIRT_SIZE) setState(STATE.DIETARY_RESTRICTIONS);
                  }}
                />
              </ProfileQuestion>

              {state >= STATE.DIETARY_RESTRICTIONS && (
                <ProfileQuestion
                  question="Do you have any dietary restrictions?"
                  onSkip={() => setState(STATE.COMPLETE)}
                  isActive={state === STATE.DIETARY_RESTRICTIONS}
                >
                  <YesNoField
                    name="dietary"
                    value={hasDietary}
                    onChange={(val) => {
                      setHasDietary(val);
                      if (state >= STATE.COMPLETE) return;
                      setState(val ? STATE.DIETARY_TEXT : STATE.COMPLETE);
                    }}
                  />
                </ProfileQuestion>
              )}

              {state >= STATE.DIETARY_TEXT && hasDietary && (
                <ProfileQuestion
                  question="List your dietary restrictions."
                  onSkip={() => {
                    setHasDietary(null);
                    setState(STATE.COMPLETE);
                  }}
                  onNext={() => {
                    !profileData.dietary_restriction ? setErrors((er) => ({ ...er, dietary_restriction: "Cannot be empty." }))
                      : setState(STATE.COMPLETE);
                  }}
                  isActive={state === STATE.DIETARY_TEXT}
                >
                  <DietaryRestrictionField
                    value={profileData.dietary_restriction}
                    error={errors.dietary_restriction}
                    onChange={(v) => {
                      setProfileData((d) => ({ ...d, dietary_restriction: v }));
                      setErrors((er) => ({ ...er, dietary_restriction: undefined }));
                    }}
                  />
                </ProfileQuestion>
              )}
            </ProfileCard>
          )}

          <div style={{ marginTop: "10px" }}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={state < STATE.DATE_OF_BIRTH}
              loading={loading}
              fullWidth
            >
              {state >= STATE.COMPLETE ? "Complete" : "Finish setup"}
            </Button>
          </div>

          <div>
            {errors.form && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-danger)" }}>
                {errors.form}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
