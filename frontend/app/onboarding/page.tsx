"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import {
  type CompetitionExperienceDraft,
  CompetitionExperienceSpreadsheet,
  competitionDraftToItem,
  competitionExperienceToDraft,
  isCompetitionRowValid,
  isVolunteerRowValid,
  type VolunteerExperienceDraft,
  VolunteerExperienceSpreadsheet,
  volunteerDraftToItem,
  volunteerExperienceToDraft,
} from "@/components/profile/ExperienceTables";
import { ProfileCard } from "@/components/profile/ProfileCard";
import {
  DietaryRestrictionField,
  EmployerField,
  GraduationYearField,
  MajorField,
  PronounsField,
  ShirtSizeField,
  StudentStatusField,
  UniversityField,
  YearLevelField,
  YesNoField,
} from "@/components/profile/ProfileFields";
import { ProfileQuestion } from "@/components/profile/ProfileQuestion";
import { Button } from "@/components/ui/Button";
import { IconInfo } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ApiError,
  type CanonicalEvent,
  canonicalEventsApi,
  type SHIRT_SIZE,
  type STUDENT_STATUS,
  type University,
  type UserMeFull,
  universitiesApi,
  usersApi,
} from "@/lib/api";
import {
  DATE_OF_BIRTH_DISCLAIMER,
  formatPhone,
  safeRedirectPath,
  validateDateOfBirth,
  validatePhone,
} from "@/lib/auth";
import { todayLocalDateString } from "@/lib/date";
import { useAuth } from "@/lib/useAuth";
import { useFormattedInputChange } from "@/lib/useFormattedInput";
import styles from "./Onboarding.module.css";

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

const NO_EXPERIENCE_ROWS = "Add at least one entry, or skip this question.";

interface ProfileDraft {
  date_of_birth?: string;
  pronouns?: string;
  student_status?: STUDENT_STATUS;
  university_id?: number;
  university_name?: string;
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
  return (
    <Suspense
      fallback={
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = safeRedirectPath(searchParams.get("redirect"));

  const [original, setOriginal] = useState<UserMeFull | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [state, setState] = useState<number>(STATE.NAME);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState<{ first: string; last: string }>({ first: "", last: "" });
  const [phone, setPhone] = useState("");
  const handlePhoneChange = useFormattedInputChange(phone, setPhone, formatPhone, (v) =>
    v.replace(/\D/g, "").slice(0, 10),
  );

  const [profileData, setProfileData] = useState<ProfileDraft>({});
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  const [universities, setUniversities] = useState<University[]>([]);
  const [competitionRows, setCompetitionRows] = useState<CompetitionExperienceDraft[]>([]);
  const [volunteerRows, setVolunteerRows] = useState<VolunteerExperienceDraft[]>([]);
  const [hasDietary, setHasDietary] = useState<boolean | null>(null);

  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [showCompetitionRowErrors, setShowCompetitionRowErrors] = useState(false);
  const [showVolunteerRowErrors, setShowVolunteerRowErrors] = useState(false);
  const competitionSectionRef = useRef<HTMLDivElement>(null);
  const volunteerSectionRef = useRef<HTMLDivElement>(null);

  // ── Effective flags — derived from actual row presence, not just the stored flag ──
  const effectiveHasCompetitionExp =
    !!profileData.has_competition_experience || competitionRows.length > 0;
  const effectiveHasVolunteerExp =
    !!profileData.has_volunteer_experience || volunteerRows.length > 0;
  const competitionLocked = effectiveHasCompetitionExp && competitionRows.length > 0;
  const volunteerLocked = effectiveHasVolunteerExp && volunteerRows.length > 0;

  useEffect(() => {
    if (authLoading) return;

    if (!currentUser) {
      router.replace("/");
      return;
    }

    if (currentUser.is_onboarding_complete) {
      router.replace(redirect ?? "/dashboard");
      return;
    }

    usersApi
      .meFull()
      .then((user) => {
        setOriginal(user);
        setName({ first: user.first_name ?? "", last: user.last_name ?? "" });
        setPhone(user.phone ?? "");
        setProfileData({
          date_of_birth: user.date_of_birth ?? undefined,
          pronouns: user.pronouns ?? undefined,
          student_status: user.student_status ?? undefined,
          university_id: user.university?.id ?? undefined,
          university_name: user.university?.name ?? undefined,
          major: user.major ?? undefined,
          year_level: user.year_level ?? undefined,
          graduation_year: user.graduation_year ?? undefined,
          employer: user.employer ?? undefined,
          has_competition_experience: user.has_competition_experience ?? undefined,
          has_volunteer_experience: user.has_volunteer_experience ?? undefined,
          shirt_size: user.shirt_size ?? undefined,
          dietary_restriction: user.dietary_restriction ?? undefined,
        });
        setHasDietary(
          user.dietary_restriction !== null ? user.dietary_restriction !== "None" : null,
        );
        setCompetitionRows(user.competition_experience.map(competitionExperienceToDraft));
        setVolunteerRows(user.volunteer_experience.map(volunteerExperienceToDraft));
      })
      .catch(() => setLoadError("Failed to load your account."));

    canonicalEventsApi
      .list()
      .then(setEvents)
      .catch(() => {});
    universitiesApi
      .list()
      .then(setUniversities)
      .catch(() => {});
  }, [authLoading, currentUser, router, redirect]);

  function validateCompetitionRows(): boolean {
    if (competitionRows.length === 0) {
      setErrors((er) => ({ ...er, competition_exp: NO_EXPERIENCE_ROWS }));
      return false;
    }
    if (!competitionRows.every(isCompetitionRowValid)) {
      setShowCompetitionRowErrors(true);
      return false;
    }
    return true;
  }

  function validateVolunteerRows(): boolean {
    if (volunteerRows.length === 0) {
      setErrors((er) => ({ ...er, volunteering_exp: NO_EXPERIENCE_ROWS }));
      return false;
    }
    if (!volunteerRows.every(isVolunteerRowValid)) {
      setShowVolunteerRowErrors(true);
      return false;
    }
    return true;
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!original) return;

    const ers: Record<string, string | undefined> = {};
    if (!name.first.trim()) ers.first_name = "Cannot be empty.";
    if (!name.last.trim()) ers.last_name = "Cannot be empty.";
    const phoneErr = validatePhone(phone);
    if (phoneErr) ers.phone = phoneErr;
    const dobErr = validateDateOfBirth(profileData.date_of_birth ?? "");
    if (dobErr) ers.date_of_birth = dobErr;

    const isStudent =
      profileData.student_status === "Undergraduate" || profileData.student_status === "Graduate";
    if (isStudent && profileData.university_name?.trim() && !profileData.university_id) {
      ers.university = "Select a university from the list.";
    }

    if (Object.keys(ers).length > 0) {
      setErrors((er) => ({ ...er, ...ers }));
      if (ers.first_name || ers.last_name) setState(STATE.NAME);
      else if (ers.phone) setState(STATE.PHONE);
      else if (ers.date_of_birth) setState(STATE.DATE_OF_BIRTH);
      else if (ers.university) setState(STATE.UNIVERSITY);
      return;
    }

    const competitionOk = !effectiveHasCompetitionExp || validateCompetitionRows();
    const volunteerOk = !effectiveHasVolunteerExp || validateVolunteerRows();
    if (!competitionOk || !volunteerOk) {
      (competitionOk ? volunteerSectionRef : competitionSectionRef).current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    setLoading(true);
    setErrors({});

    const { university_name: _university_name, ...restProfileData } = profileData;

    const cleaned: Record<string, unknown> = {
      first_name: name.first,
      last_name: name.last,
      phone,
      ...restProfileData,
      has_competition_experience:
        competitionRows.length > 0 ? true : profileData.has_competition_experience,
      has_volunteer_experience:
        volunteerRows.length > 0 ? true : profileData.has_volunteer_experience,
    };

    if (cleaned.student_status === "Undergraduate" || cleaned.student_status === "Graduate") {
      cleaned.employer = undefined;
    } else if (cleaned.student_status === "Non-Student") {
      cleaned.university_id =
        cleaned.major =
        cleaned.year_level =
        cleaned.graduation_year =
          undefined;
    } else {
      cleaned.student_status =
        cleaned.employer =
        cleaned.university_id =
        cleaned.major =
        cleaned.year_level =
        cleaned.graduation_year =
          undefined;
    }

    for (const key of Object.keys(cleaned)) {
      if (cleaned[key] === "") cleaned[key] = null;
    }
    // GraduationYearField emits `undefined` (not "") when cleared, since it
    // parses the raw text to a number — normalize separately.
    if (cleaned.graduation_year === undefined) cleaned.graduation_year = null;

    try {
      await usersApi.updateMe(cleaned);
      // An empty list deletes saved rows, which is right when the answer is No.
      await Promise.all([
        usersApi.replaceCompetitionExperience(
          effectiveHasCompetitionExp ? competitionRows.map(competitionDraftToItem) : [],
        ),
        usersApi.replaceVolunteerExperience(
          effectiveHasVolunteerExp ? volunteerRows.map(volunteerDraftToItem) : [],
        ),
      ]);

      window.location.href = redirect ?? "/dashboard";
    } catch (error: unknown) {
      setErrors({
        form: error instanceof ApiError ? error.message : "Something went wrong. Try again.",
      });
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
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "13px",
          color: "var(--color-text-tertiary)",
        }}
      >
        {loadError ?? "Something went wrong."}
      </p>
    );
  }

  return (
    <div className={styles.page}>
      <Topbar showWordmark showAvatar="logout-only" />
      <div className={styles.container}>
        <PageHeader heading="Complete Your Profile" />

        <form onSubmit={handleSubmit} noValidate className={styles.form}>
          <ProfileCard>
            <ProfileQuestion
              question="What is your name?"
              required
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
                  onChange={(e) => {
                    setName((n) => ({ ...n, first: e.target.value }));
                    setErrors((er) => ({ ...er, first_name: undefined }));
                  }}
                  autoComplete="given-name"
                  error={errors.first_name}
                  fullWidth
                />
                <Input
                  label="Last Name"
                  type="text"
                  value={name.last}
                  onChange={(e) => {
                    setName((n) => ({ ...n, last: e.target.value }));
                    setErrors((er) => ({ ...er, last_name: undefined }));
                  }}
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
                required
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
                  onChange={(e) => {
                    handlePhoneChange(e);
                    setErrors((er) => ({ ...er, phone: undefined }));
                  }}
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
                question={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    What is your date of birth?
                    <Tooltip
                      variant="info"
                      message={DATE_OF_BIRTH_DISCLAIMER}
                      showIcon={false}
                      maxWidth={400}
                    >
                      <span style={{ display: "flex", color: "var(--color-text-tertiary)" }}>
                        <IconInfo size={13} />
                      </span>
                    </Tooltip>
                  </span>
                }
                required
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
                  max={todayLocalDateString()}
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
                required
                onNext={
                  profileData.student_status
                    ? () =>
                        setState(
                          profileData.student_status === "Non-Student"
                            ? STATE.EMPLOYER
                            : STATE.UNIVERSITY,
                        )
                    : undefined
                }
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

              {state >= STATE.UNIVERSITY &&
                (profileData.student_status === "Undergraduate" ||
                  profileData.student_status === "Graduate") && (
                  <>
                    <ProfileQuestion question="What university do you attend?" required>
                      <UniversityField
                        universities={universities}
                        value={profileData.university_name ?? ""}
                        error={errors.university}
                        onChange={(text, universityId) => {
                          setProfileData((d) => ({
                            ...d,
                            university_name: text,
                            university_id: universityId ?? undefined,
                          }));
                          setErrors((er) => ({ ...er, university: undefined }));
                        }}
                      />
                    </ProfileQuestion>
                    <ProfileQuestion question="What is your major?" required>
                      <MajorField
                        value={profileData.major}
                        error={errors.major}
                        onChange={(v) => {
                          setProfileData((d) => ({ ...d, major: v }));
                          setErrors((er) => ({ ...er, major: undefined }));
                        }}
                      />
                    </ProfileQuestion>
                    <ProfileQuestion question="What is your grade level?" required>
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
                      required
                      onNext={() => {
                        const ers: typeof errors = {};

                        if (!profileData.university_id) ers.university = "Cannot be empty.";
                        if (!profileData.major) ers.major = "Cannot be empty.";
                        if (!profileData.year_level) ers.year_level = "Cannot be empty.";

                        if (!profileData.graduation_year) ers.graduation_year = "Cannot be empty.";
                        else if (
                          profileData.graduation_year < 1000 ||
                          profileData.graduation_year > 9999
                        )
                          ers.graduation_year = "Must be a valid year.";

                        Object.keys(ers).length > 0
                          ? setErrors((er) => ({ ...er, ...ers }))
                          : setState(STATE.UNIVERSITY + 2);
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
                  required
                  onNext={() => {
                    !profileData.employer
                      ? setErrors((er) => ({ ...er, employer: "Cannot be empty." }))
                      : setState(STATE.COMPETED_BEFORE);
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
                required
                onNext={
                  effectiveHasCompetitionExp
                    ? () => setState(STATE.COMPETITION_EXP)
                    : profileData.has_competition_experience === false
                      ? () => setState(STATE.VOLUNTEERED_BEFORE)
                      : undefined
                }
                isActive={state === STATE.COMPETED_BEFORE}
              >
                <div>
                  <YesNoField
                    value={
                      effectiveHasCompetitionExp
                        ? true
                        : (profileData.has_competition_experience ?? null)
                    }
                    onChange={(val) => {
                      setProfileData((d) => ({ ...d, has_competition_experience: val }));
                      if (state >= STATE.COMPETED_BEFORE + 2) return;
                      setState(val ? STATE.COMPETITION_EXP : STATE.COMPETED_BEFORE + 2);
                    }}
                    locked={competitionLocked}
                  />
                  {competitionLocked && (
                    <p
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "12px",
                        color: "var(--color-text-tertiary)",
                        marginTop: "6px",
                      }}
                    >
                      Remove all competition experience entries below to change this.
                    </p>
                  )}
                </div>
              </ProfileQuestion>

              {(competitionLocked ||
                (state >= STATE.COMPETITION_EXP && profileData.has_competition_experience)) && (
                <div ref={competitionSectionRef}>
                  <ProfileQuestion
                    question="Add your competition experience."
                    onSkip={() => {
                      setProfileData((d) => ({ ...d, has_competition_experience: false }));
                      setCompetitionRows([]);
                      setShowCompetitionRowErrors(false);
                      setErrors((er) => ({ ...er, competition_exp: undefined }));
                      setState(STATE.VOLUNTEERED_BEFORE);
                    }}
                    onNext={() => {
                      if (!validateCompetitionRows()) return;
                      setShowCompetitionRowErrors(false);
                      setState(STATE.VOLUNTEERED_BEFORE);
                    }}
                    isActive={state === STATE.COMPETITION_EXP}
                  >
                    <CompetitionExperienceSpreadsheet
                      mode="edit"
                      rows={competitionRows}
                      onChange={(rows) => {
                        setCompetitionRows(rows);
                        setErrors((er) => ({ ...er, competition_exp: undefined }));
                      }}
                      showErrors={showCompetitionRowErrors}
                      events={events}
                    />
                    {errors.competition_exp && (
                      <p
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "13px",
                          color: "var(--color-danger)",
                          marginTop: "6px",
                        }}
                      >
                        {errors.competition_exp}
                      </p>
                    )}
                  </ProfileQuestion>
                </div>
              )}
            </ProfileCard>
          )}

          {state >= STATE.VOLUNTEERED_BEFORE && (
            <ProfileCard>
              <ProfileQuestion
                question="Have you volunteered for Science Olympiad before?"
                required
                onNext={
                  effectiveHasVolunteerExp
                    ? () => setState(STATE.VOLUNTEERING_EXP)
                    : profileData.has_volunteer_experience === false
                      ? () => setState(STATE.SHIRT_SIZE)
                      : undefined
                }
                isActive={state === STATE.VOLUNTEERED_BEFORE}
              >
                <div>
                  <YesNoField
                    value={
                      effectiveHasVolunteerExp
                        ? true
                        : (profileData.has_volunteer_experience ?? null)
                    }
                    onChange={(val) => {
                      setProfileData((d) => ({ ...d, has_volunteer_experience: val }));
                      if (state >= STATE.SHIRT_SIZE) return;
                      setState(val ? STATE.VOLUNTEERING_EXP : STATE.SHIRT_SIZE);
                    }}
                    locked={volunteerLocked}
                  />
                  {volunteerLocked && (
                    <p
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "12px",
                        color: "var(--color-text-tertiary)",
                        marginTop: "6px",
                      }}
                    >
                      Remove all volunteer experience entries below to change this.
                    </p>
                  )}
                </div>
              </ProfileQuestion>

              {(volunteerLocked ||
                (state >= STATE.VOLUNTEERING_EXP && profileData.has_volunteer_experience)) && (
                <div ref={volunteerSectionRef}>
                  <ProfileQuestion
                    question="Add your volunteer experience."
                    onSkip={() => {
                      setProfileData((d) => ({ ...d, has_volunteer_experience: false }));
                      setVolunteerRows([]);
                      setShowVolunteerRowErrors(false);
                      setErrors((er) => ({ ...er, volunteering_exp: undefined }));
                      setState(STATE.SHIRT_SIZE);
                    }}
                    onNext={() => {
                      if (!validateVolunteerRows()) return;
                      setShowVolunteerRowErrors(false);
                      setState(STATE.SHIRT_SIZE);
                    }}
                    isActive={state === STATE.VOLUNTEERING_EXP}
                  >
                    <VolunteerExperienceSpreadsheet
                      mode="edit"
                      rows={volunteerRows}
                      onChange={(rows) => {
                        setVolunteerRows(rows);
                        setErrors((er) => ({ ...er, volunteering_exp: undefined }));
                      }}
                      showErrors={showVolunteerRowErrors}
                      events={events}
                    />
                    {errors.volunteering_exp && (
                      <p
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "13px",
                          color: "var(--color-danger)",
                          marginTop: "6px",
                        }}
                      >
                        {errors.volunteering_exp}
                      </p>
                    )}
                  </ProfileQuestion>
                </div>
              )}
            </ProfileCard>
          )}

          {state >= STATE.SHIRT_SIZE && (
            <ProfileCard>
              <ProfileQuestion
                question="What is your shirt size?"
                required
                onNext={
                  profileData.shirt_size ? () => setState(STATE.DIETARY_RESTRICTIONS) : undefined
                }
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
                  required
                  onNext={
                    hasDietary !== null
                      ? () => setState(hasDietary ? STATE.DIETARY_TEXT : STATE.COMPLETE)
                      : undefined
                  }
                  isActive={state === STATE.DIETARY_RESTRICTIONS}
                >
                  <YesNoField
                    value={hasDietary}
                    onChange={(val) => {
                      setHasDietary(val);
                      setProfileData((d) => ({ ...d, dietary_restriction: val ? "" : "None" }));
                      if (state >= STATE.COMPLETE) return;
                      setState(val ? STATE.DIETARY_TEXT : STATE.COMPLETE);
                    }}
                  />
                </ProfileQuestion>
              )}

              {state >= STATE.DIETARY_TEXT && hasDietary && (
                <ProfileQuestion
                  question="List your dietary restrictions."
                  required
                  onNext={() => {
                    !profileData.dietary_restriction
                      ? setErrors((er) => ({ ...er, dietary_restriction: "Cannot be empty." }))
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
              disabled={state < STATE.COMPLETE}
              loading={loading}
              fullWidth
            >
              Complete
            </Button>
          </div>

          <div>
            {errors.form && (
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "14px",
                  color: "var(--color-danger)",
                }}
              >
                {errors.form}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
