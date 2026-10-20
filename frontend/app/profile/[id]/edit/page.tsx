"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import styles from "@/components/profile/Profile.module.css";
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
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import { Button } from "@/components/ui/Button";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { IconArrowLeft } from "@/components/ui/Icons";
import { Spinner } from "@/components/ui/Spinner";
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
import { useAuth } from "@/lib/useAuth";
import { useBlockNavigation, useUnsavedChanges } from "@/lib/useUnsavedChanges";

const NO_EXPERIENCE_ROWS = "Add at least one entry, or answer No above.";

interface ProfileDraft {
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

function profileToDraft(user: UserMeFull): ProfileDraft {
  return {
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
  };
}

export default function ProfileEditPage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const profileId = params.id as string;
  const { guard } = useUnsavedChanges();

  const [original, setOriginal] = useState<UserMeFull | null>(null);
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  const [universities, setUniversities] = useState<University[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ProfileDraft>({});
  const [hasDietary, setHasDietary] = useState<boolean | null>(null);
  const [competitionRows, setCompetitionRows] = useState<CompetitionExperienceDraft[]>([]);
  const [volunteerRows, setVolunteerRows] = useState<VolunteerExperienceDraft[]>([]);

  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [showCompetitionRowErrors, setShowCompetitionRowErrors] = useState(false);
  const [showVolunteerRowErrors, setShowVolunteerRowErrors] = useState(false);
  const competitionSectionRef = useRef<HTMLDivElement>(null);
  const volunteerSectionRef = useRef<HTMLDivElement>(null);

  // ── Load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;

    if (!currentUser) {
      router.replace("/");
      return;
    }

    if (String(currentUser.id) !== String(profileId)) {
      router.replace("/dashboard");
      return;
    }

    usersApi
      .meFull()
      .then((user) => {
        setOriginal(user);
        setDraft(profileToDraft(user));
        setHasDietary(
          user.dietary_restriction !== null ? user.dietary_restriction !== "None" : null,
        );
        setCompetitionRows(user.competition_experience.map(competitionExperienceToDraft));
        setVolunteerRows(user.volunteer_experience.map(volunteerExperienceToDraft));
      })
      .catch(() => setLoadError("Failed to load profile."));

    canonicalEventsApi
      .list()
      .then(setEvents)
      .catch(() => {});
    universitiesApi
      .list()
      .then(setUniversities)
      .catch(() => {});
  }, [authLoading, currentUser, profileId, router]);

  // ── Effective flags — derived from actual row presence, not just the stored flag ──
  const effectiveHasCompetitionExp =
    !!draft.has_competition_experience || competitionRows.length > 0;
  const effectiveHasVolunteerExp = !!draft.has_volunteer_experience || volunteerRows.length > 0;
  const competitionLocked = effectiveHasCompetitionExp && competitionRows.length > 0;
  const volunteerLocked = effectiveHasVolunteerExp && volunteerRows.length > 0;

  // ── Dirty tracking ──────────────────────────────────────────────────────
  const isDirty = useMemo(() => {
    if (!original) return false;
    const originalDraft = profileToDraft(original);
    const draftChanged = JSON.stringify(draft) !== JSON.stringify(originalDraft);

    const originalCompetition = original.competition_experience.map(competitionExperienceToDraft);
    const competitionChanged =
      JSON.stringify(competitionRows) !== JSON.stringify(originalCompetition);

    const originalVolunteer = original.volunteer_experience.map(volunteerExperienceToDraft);
    const volunteerChanged = JSON.stringify(volunteerRows) !== JSON.stringify(originalVolunteer);

    return draftChanged || competitionChanged || volunteerChanged;
  }, [draft, competitionRows, volunteerRows, original]);

  // Registers the dirty state with the provider in this route's layout, which
  // then intercepts link clicks and browser navigation away from the page.
  useBlockNavigation(isDirty);

  // ── Cancel ──────────────────────────────────────────────────────────────
  function handleCancel() {
    if (!original) return;
    setDraft(profileToDraft(original));
    setHasDietary(
      original.dietary_restriction !== null ? original.dietary_restriction !== "None" : null,
    );
    setCompetitionRows(original.competition_experience.map(competitionExperienceToDraft));
    setVolunteerRows(original.volunteer_experience.map(volunteerExperienceToDraft));
    setErrors({});
    setSaveError(undefined);
    setShowCompetitionRowErrors(false);
    setShowVolunteerRowErrors(false);
  }

  // guard(), not a plain push: the provider's click interceptor only catches
  // <a> elements, and this is a button.
  function handleBack() {
    guard(() => router.push(`/profile/${profileId}`));
  }

  // ── Save ────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!original) return;
    setSaving(true);
    setSaveError(undefined);
    setErrors({});

    const ers: Record<string, string | undefined> = {};
    if (effectiveHasCompetitionExp && competitionRows.length === 0) {
      ers.competition_exp = NO_EXPERIENCE_ROWS;
    }
    if (effectiveHasVolunteerExp && volunteerRows.length === 0) {
      ers.volunteering_exp = NO_EXPERIENCE_ROWS;
    }
    const competitionRowsOk = competitionRows.every(isCompetitionRowValid);
    const volunteerRowsOk = volunteerRows.every(isVolunteerRowValid);
    setShowCompetitionRowErrors(!competitionRowsOk);
    setShowVolunteerRowErrors(!volunteerRowsOk);
    const competitionOk = !ers.competition_exp && competitionRowsOk;
    const volunteerOk = !ers.volunteering_exp && volunteerRowsOk;
    if (!competitionOk || !volunteerOk) {
      setErrors((er) => ({ ...er, ...ers }));
      (competitionOk ? volunteerSectionRef : competitionSectionRef).current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setSaving(false);
      return;
    }

    if (draft.graduation_year && (draft.graduation_year < 1000 || draft.graduation_year > 9999)) {
      setErrors((er) => ({ ...er, graduation_year: "Must be a valid year." }));
      setSaving(false);
      return;
    }

    const isStudent =
      draft.student_status === "Undergraduate" || draft.student_status === "Graduate";
    if (isStudent && draft.university_name?.trim() && !draft.university_id) {
      setErrors((er) => ({ ...er, university: "Select a university from the list." }));
      setSaving(false);
      return;
    }

    // Self-heal flags from actual row presence before sending
    const { university_name: _university_name, ...restDraft } = draft;
    const cleaned: Record<string, unknown> = {
      ...restDraft,
      has_competition_experience:
        competitionRows.length > 0 ? true : draft.has_competition_experience,
      has_volunteer_experience: volunteerRows.length > 0 ? true : draft.has_volunteer_experience,
    };

    if (cleaned.student_status === "Undergraduate" || cleaned.student_status === "Graduate") {
      cleaned.employer = undefined;
    } else if (cleaned.student_status === "Non-Student") {
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
      await Promise.all([
        usersApi.replaceCompetitionExperience(
          effectiveHasCompetitionExp ? competitionRows.map(competitionDraftToItem) : [],
        ),
        usersApi.replaceVolunteerExperience(
          effectiveHasVolunteerExp ? volunteerRows.map(volunteerDraftToItem) : [],
        ),
      ]);

      router.push(`/profile/${profileId}`);
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        setSaveError(error.message);
      } else {
        setSaveError("Something went wrong. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Loading / error states ─────────────────────────────────────────────
  if (authLoading || (!original && !loadError)) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
        <Topbar showWordmark showAvatar />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (loadError || !original) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
        <Topbar showWordmark showAvatar />
        <div
          style={{
            padding: "40px",
            fontFamily: "var(--font-sans)",
            color: "var(--color-text-tertiary)",
          }}
        >
          {loadError ?? "Profile not found."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", paddingBottom: "100px" }}>
      <Topbar showWordmark showAvatar />
      <div className={styles.page}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className={styles.backLink}
        >
          <IconArrowLeft />
          Back to profile
        </Button>

        <ProfileHeader user={original} showEditButton />

        <ProfileCard>
          <ProfileQuestion question="Pronouns">
            <PronounsField
              value={draft.pronouns ?? ""}
              onChange={(v) => setDraft((d) => ({ ...d, pronouns: v }))}
            />
          </ProfileQuestion>
        </ProfileCard>

        <ProfileCard>
          <ProfileQuestion question="Student status">
            <StudentStatusField
              value={draft.student_status}
              onChange={(v) => setDraft((d) => ({ ...d, student_status: v }))}
            />
          </ProfileQuestion>

          {(draft.student_status === "Undergraduate" || draft.student_status === "Graduate") && (
            <>
              <ProfileQuestion question="University">
                <UniversityField
                  universities={universities}
                  value={draft.university_name ?? ""}
                  error={errors.university}
                  onChange={(text, universityId) =>
                    setDraft((d) => ({
                      ...d,
                      university_name: text,
                      university_id: universityId ?? undefined,
                    }))
                  }
                />
              </ProfileQuestion>
              <ProfileQuestion question="Major">
                <MajorField
                  value={draft.major}
                  error={errors.major}
                  onChange={(v) => setDraft((d) => ({ ...d, major: v }))}
                />
              </ProfileQuestion>
              <ProfileQuestion question="Year level">
                <YearLevelField
                  value={draft.year_level}
                  error={errors.year_level}
                  onChange={(v) => setDraft((d) => ({ ...d, year_level: v }))}
                />
              </ProfileQuestion>
              <ProfileQuestion question="Projected graduation year">
                <GraduationYearField
                  value={draft.graduation_year}
                  error={errors.graduation_year}
                  onValidate={(err) => setErrors((er) => ({ ...er, graduation_year: err }))}
                  onChange={(v) => setDraft((d) => ({ ...d, graduation_year: v }))}
                />
              </ProfileQuestion>
            </>
          )}

          {draft.student_status === "Non-Student" && (
            <ProfileQuestion question="Employer">
              <EmployerField
                value={draft.employer}
                error={errors.employer}
                onChange={(v) => setDraft((d) => ({ ...d, employer: v }))}
              />
            </ProfileQuestion>
          )}
        </ProfileCard>

        <ProfileCard>
          <ProfileQuestion question="Have you competed in Science Olympiad before?">
            <div>
              <YesNoField
                value={
                  effectiveHasCompetitionExp ? true : (draft.has_competition_experience ?? null)
                }
                onChange={(val) => setDraft((d) => ({ ...d, has_competition_experience: val }))}
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

          {effectiveHasCompetitionExp && (
            <div ref={competitionSectionRef}>
              <ProfileQuestion question="Competition experience">
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

        <ProfileCard>
          <ProfileQuestion question="Have you volunteered for Science Olympiad before?">
            <div>
              <YesNoField
                value={effectiveHasVolunteerExp ? true : (draft.has_volunteer_experience ?? null)}
                onChange={(val) => setDraft((d) => ({ ...d, has_volunteer_experience: val }))}
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

          {effectiveHasVolunteerExp && (
            <div ref={volunteerSectionRef}>
              <ProfileQuestion question="Volunteer experience">
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

        <ProfileCard>
          <ProfileQuestion question="Shirt size">
            <ShirtSizeField
              value={draft.shirt_size}
              onChange={(v) => setDraft((d) => ({ ...d, shirt_size: v }))}
            />
          </ProfileQuestion>

          <ProfileQuestion question="Do you have any dietary restrictions?">
            <YesNoField
              value={hasDietary}
              onChange={(val) => {
                setHasDietary(val);
                setDraft((d) => ({ ...d, dietary_restriction: val ? "" : "None" }));
              }}
            />
          </ProfileQuestion>

          {hasDietary && (
            <ProfileQuestion question="List your dietary restrictions">
              <DietaryRestrictionField
                value={draft.dietary_restriction}
                error={errors.dietary_restriction}
                onChange={(v) => setDraft((d) => ({ ...d, dietary_restriction: v }))}
              />
            </ProfileQuestion>
          )}
        </ProfileCard>
      </div>

      <FloatingSaveBar
        visible={isDirty}
        saving={saving}
        error={saveError}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  );
}
