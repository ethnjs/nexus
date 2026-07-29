"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import {
  usersApi, canonicalEventsApi, CanonicalEvent,
  STUDENT_STATUS, SHIRT_SIZE, UserMeFull, ApiError,
} from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { Topbar } from "@/components/layout/Topbar";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
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



interface ProfileDraft {
  pronouns?: string
  student_status?: STUDENT_STATUS
  university?: string
  major?: string
  year_level?: number
  graduation_year?: number
  employer?: string
  has_competition_experience?: boolean
  has_volunteer_experience?: boolean
  shirt_size?: SHIRT_SIZE
  dietary_restriction?: string
}

function profileToDraft(user: UserMeFull): ProfileDraft {
  return {
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
  }
}

export default function ProfileEditPage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const profileId = params.id as string;

  const [original, setOriginal] = useState<UserMeFull | null>(null);
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ProfileDraft>({});
  const [hasDietary, setHasDietary] = useState<boolean | null>(null);
  const [competitionRows, setCompetitionRows] = useState<CompetitionExperienceDraft[]>([]);
  const [volunteerRows, setVolunteerRows] = useState<VolunteerExperienceDraft[]>([]);

  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

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

    usersApi.meFull()
      .then(user => {
        setOriginal(user);
        setDraft(profileToDraft(user));
        setHasDietary(user.dietary_restriction !== null ? true : null);
        setCompetitionRows(user.competition_experience.map(competitionExperienceToDraft));
        setVolunteerRows(user.volunteer_experience.map(volunteerExperienceToDraft));
      })
      .catch(() => setLoadError("Failed to load profile."));

    canonicalEventsApi.list().then(setEvents).catch(() => {});
  }, [authLoading, currentUser, profileId, router]);

  // ── Effective flags — derived from actual row presence, not just the stored flag ──
  const effectiveHasCompetitionExp = !!draft.has_competition_experience || competitionRows.length > 0;
  const effectiveHasVolunteerExp = !!draft.has_volunteer_experience || volunteerRows.length > 0;
  const competitionLocked = effectiveHasCompetitionExp && competitionRows.length > 0;
  const volunteerLocked = effectiveHasVolunteerExp && volunteerRows.length > 0;

  // ── Dirty tracking ──────────────────────────────────────────────────────
  const isDirty = useMemo(() => {
    if (!original) return false;
    const originalDraft = profileToDraft(original);
    const draftChanged = JSON.stringify(draft) !== JSON.stringify(originalDraft);

    const originalCompetition = original.competition_experience.map(competitionExperienceToDraft);
    const competitionChanged = JSON.stringify(competitionRows) !== JSON.stringify(originalCompetition);

    const originalVolunteer = original.volunteer_experience.map(volunteerExperienceToDraft);
    const volunteerChanged = JSON.stringify(volunteerRows) !== JSON.stringify(originalVolunteer);

    return draftChanged || competitionChanged || volunteerChanged;
  }, [draft, competitionRows, volunteerRows, original]);

  // ── Cancel ──────────────────────────────────────────────────────────────
  function handleCancel() {
    if (!original) return;
    setDraft(profileToDraft(original));
    setHasDietary(original.dietary_restriction !== null ? true : null);
    setCompetitionRows(original.competition_experience.map(competitionExperienceToDraft));
    setVolunteerRows(original.volunteer_experience.map(volunteerExperienceToDraft));
    setErrors({});
    setSaveError(undefined);
  }

  function handleBack() {
    router.push(`/profile/${profileId}`);
  }

  // ── Row diffing helpers ─────────────────────────────────────────────────
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

  // ── Save ────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!original) return;
    setSaving(true);
    setSaveError(undefined);
    setErrors({});

    // Validate rows before saving anything
    if (!competitionRows.every(isCompetitionRowValid)) {
      setSaveError("Every competition experience row needs a school and a matched event.");
      setSaving(false);
      return;
    }
    if (!volunteerRows.every(isVolunteerRowValid)) {
      setSaveError("Every volunteer experience row needs a tournament name, a 4-digit year, and a role.");
      setSaving(false);
      return;
    }

    const dobErr = null; // DOB not editable on this page
    if (dobErr) { /* unreachable, kept for parity with sign-up validation shape */ }

    if (draft.graduation_year && (draft.graduation_year < 1000 || draft.graduation_year > 9999)) {
      setErrors(er => ({ ...er, graduation_year: "Must be a valid year." }));
      setSaving(false);
      return;
    }

    // Self-heal flags from actual row presence before sending
    const cleaned: Record<string, unknown> = {
      ...draft,
      has_competition_experience: competitionRows.length > 0 ? true : draft.has_competition_experience,
      has_volunteer_experience: volunteerRows.length > 0 ? true : draft.has_volunteer_experience,
    };

    if (cleaned.student_status === 'Undergraduate' || cleaned.student_status === 'Graduate') {
      cleaned.employer = undefined;
    } else if (cleaned.student_status === 'Non-Student') {
      cleaned.university = cleaned.major = cleaned.year_level = cleaned.graduation_year = undefined;
    }

    for (const key of Object.keys(cleaned)) {
      if (cleaned[key] === "") cleaned[key] = undefined;
    }

    try {
      await usersApi.updateMe(cleaned);

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

      const volDiff = diffRows(original.volunteer_experience.map(volunteerExperienceToDraft), volunteerRows);
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
      await Promise.all([
        ...volDiff.toAdd.map(row => usersApi.addVolunteerExperience(volunteerBody(row))),
        ...volDiff.toUpdate.map(row => usersApi.updateVolunteerExperience(row.id as number, volunteerBody(row))),
        ...volDiff.toDelete.map(row => usersApi.deleteVolunteerExperience(row.id as number)),
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
        <div style={{ padding: "40px", fontFamily: "var(--font-sans)", color: "var(--color-text-tertiary)" }}>
          {loadError ?? "Profile not found."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", paddingBottom: "100px" }}>
      <Topbar showWordmark showAvatar />
      <div style={{
        maxWidth: "900px", margin: "0 auto", padding: "32px 20px",
        display: "flex", flexDirection: "column", gap: "20px",
      }}>
        <ProfileHeader user={original} showEditButton />

        <ProfileCard>
          <ProfileQuestion question="Pronouns">
            <PronounsField
              value={draft.pronouns ?? ''}
              onChange={(v) => setDraft(d => ({ ...d, pronouns: v }))}
            />
          </ProfileQuestion>
        </ProfileCard>

        <ProfileCard>
          <ProfileQuestion question="Student status">
            <StudentStatusField
              value={draft.student_status}
              onChange={(v) => setDraft(d => ({ ...d, student_status: v }))}
            />
          </ProfileQuestion>

          {(draft.student_status === "Undergraduate" || draft.student_status === "Graduate") && (
            <>
              <ProfileQuestion question="University">
                <UniversityField
                  value={draft.university}
                  error={errors.university}
                  onChange={(v) => setDraft(d => ({ ...d, university: v }))}
                />
              </ProfileQuestion>
              <ProfileQuestion question="Major">
                <MajorField
                  value={draft.major}
                  error={errors.major}
                  onChange={(v) => setDraft(d => ({ ...d, major: v }))}
                />
              </ProfileQuestion>
              <ProfileQuestion question="Year level">
                <YearLevelField
                  value={draft.year_level}
                  error={errors.year_level}
                  onChange={(v) => setDraft(d => ({ ...d, year_level: v }))}
                />
              </ProfileQuestion>
              <ProfileQuestion question="Projected graduation year">
                <GraduationYearField
                  value={draft.graduation_year}
                  error={errors.graduation_year}
                  onValidate={(err) => setErrors(er => ({ ...er, graduation_year: err }))}
                  onChange={(v) => setDraft(d => ({ ...d, graduation_year: v }))}
                />
              </ProfileQuestion>
            </>
          )}

          {draft.student_status === "Non-Student" && (
            <ProfileQuestion question="Employer">
              <EmployerField
                value={draft.employer}
                error={errors.employer}
                onChange={(v) => setDraft(d => ({ ...d, employer: v }))}
              />
            </ProfileQuestion>
          )}
        </ProfileCard>

        <ProfileCard>
          <ProfileQuestion question="Have you competed in Science Olympiad before?">
            <div>
              <YesNoField
                name="competed"
                value={effectiveHasCompetitionExp ? true : (draft.has_competition_experience ?? null)}
                onChange={(val) => setDraft(d => ({ ...d, has_competition_experience: val }))}
                disabled={competitionLocked}
              />
              {competitionLocked && (
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "6px" }}>
                  Remove all competition experience entries below to change this.
                </p>
              )}
            </div>
          </ProfileQuestion>

          {effectiveHasCompetitionExp && (
            <ProfileQuestion question="Competition experience">
              <CompetitionExperienceSpreadsheet
                mode="edit"
                rows={competitionRows}
                onChange={setCompetitionRows}
                events={events}
              />
            </ProfileQuestion>
          )}
        </ProfileCard>

        <ProfileCard>
          <ProfileQuestion question="Have you volunteered for Science Olympiad before?">
            <div>
              <YesNoField
                name="volunteered"
                value={effectiveHasVolunteerExp ? true : (draft.has_volunteer_experience ?? null)}
                onChange={(val) => setDraft(d => ({ ...d, has_volunteer_experience: val }))}
                disabled={volunteerLocked}
              />
              {volunteerLocked && (
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "6px" }}>
                  Remove all volunteer experience entries below to change this.
                </p>
              )}
            </div>
          </ProfileQuestion>

          {effectiveHasVolunteerExp && (
            <ProfileQuestion question="Volunteer experience">
              <VolunteerExperienceSpreadsheet
                mode="edit"
                rows={volunteerRows}
                onChange={setVolunteerRows}
                events={events}
              />
            </ProfileQuestion>
          )}
        </ProfileCard>

        <ProfileCard>
          <ProfileQuestion question="Shirt size">
            <ShirtSizeField
              value={draft.shirt_size}
              onChange={(v) => setDraft(d => ({ ...d, shirt_size: v }))}
            />
          </ProfileQuestion>

          <ProfileQuestion question="Do you have any dietary restrictions?">
            <YesNoField
              name="dietary"
              value={hasDietary}
              onChange={(val) => {
                setHasDietary(val);
                if (!val) setDraft(d => ({ ...d, dietary_restriction: undefined }));
              }}
            />
          </ProfileQuestion>

          {hasDietary && (
            <ProfileQuestion question="List your dietary restrictions">
              <DietaryRestrictionField
                value={draft.dietary_restriction}
                error={errors.dietary_restriction}
                onChange={(v) => setDraft(d => ({ ...d, dietary_restriction: v }))}
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