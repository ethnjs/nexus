"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import {
  usersApi, canonicalEventsApi, tournamentsApi, CanonicalEvent, CompetitionExperience, VolunteerExperience,
  MembershipFull, Tournament,
} from "@/lib/api";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import type { UserFull, UserMeFull } from "@/lib/api";
import { Topbar } from "@/components/layout/Topbar";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { EducationCareerSection } from "@/components/profile/sections/EducationCareerSection";
import { CompetitionExperienceSection } from "@/components/profile/sections/CompetitionExperienceSection";
import { VolunteerExperienceSection } from "@/components/profile/sections/VolunteerExperienceSection";
import { LogisticsSection } from "@/components/profile/sections/LogisticsSection";
import { CompetitionExperienceDraft, VolunteerExperienceDraft } from "@/components/profile/ExperienceTables";
import { PanelField } from "@/components/profile/PanelField";
import { AgeFlagsBadges } from "@/components/tournament/sections/AgeFlagsBadges";
import { AvailabilitySection } from "@/components/tournament/sections/AvailabilitySection";
import { LunchSection } from "@/components/tournament/sections/LunchSection";
import { EventPreferencesSection } from "@/components/tournament/sections/EventPreferencesSection";
import { CustomResponsesSection } from "@/components/tournament/sections/CustomResponsesSection";
import Link from "next/link";
import { IconEdit } from "@/components/ui/Icons";

function ageDisclosureBannerMessage(tournament: Tournament): string {
  if (tournament.collect_is_over_18 && tournament.collect_is_over_21) {
    return `${tournament.name} can see whether you're 18+ and 21+ — never your date of birth.`;
  }
  if (tournament.collect_is_over_21) {
    return `${tournament.name} can see whether you're 21+ — never your date of birth.`;
  }
  return `${tournament.name} can see whether you're 18+ — never your date of birth.`;
}

// One membership's tournament sections — Age Flags alongside Availability/
// Lunch/Event Preferences/Custom Responses, same components MemberPanel
// uses. Labeled with the tournament name only when there's more than one
// membership to tell apart (the common case, viewing one tournament, needs
// no extra fetch to find out).
function MembershipTournamentSections({ membership, tournament, tournamentName }: {
  membership: MembershipFull; tournament?: Tournament; tournamentName?: string;
}) {
  const collectsAgeFlag = !!tournament && (tournament.collect_is_over_18 || tournament.collect_is_over_21);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {tournamentName && (
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>
          {tournamentName}
        </h2>
      )}
      {collectsAgeFlag && (
        <Banner variant="info" message={ageDisclosureBannerMessage(tournament!)} />
      )}
      <ProfileCard>
        <PanelField label="Age Flags">
          <AgeFlagsBadges isOver18={membership.is_over_18} isOver21={membership.is_over_21} />
        </PanelField>
      </ProfileCard>
      <AvailabilitySection availability={membership.availability} />
      <LunchSection lunch={membership.lunch} />
      <EventPreferencesSection eventPreferences={membership.event_preferences} />
      <CustomResponsesSection customResponses={membership.custom_responses} />
    </div>
  );
}


interface FloatingEditButtonProps {
  profileId: string | number;
}

export function FloatingEditButton({ profileId }: FloatingEditButtonProps) {
  return (
    <Link
      href={`/profile/${profileId}/edit`}
      style={{
        position: "fixed", bottom: "32px", right: "32px",
        width: "52px", height: "52px", borderRadius: "50%",
        background: "var(--color-accent)", color: "var(--color-text-inverse)",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "var(--shadow-lg)", textDecoration: "none",
        transition: "transform 0.15s ease",
        zIndex: 50,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.06)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      <IconEdit size={20} />
    </Link>
  );
}


export default function ProfilePage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const profileId = params.id as string;

  const [profile, setProfile] = useState<UserFull | UserMeFull | null>(null);
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  const [memberships, setMemberships] = useState<MembershipFull[]>([]);
  const [tournaments, setTournaments] = useState<Record<number, Tournament>>({});
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const isOwnProfile = !!currentUser && !!profile && String(currentUser.id) === String(profile.id);

  useEffect(() => {
    if (authLoading) return; // wait for auth to resolve either way

    if (!currentUser) {
      router.replace("/"); // not logged in at all
      return;
    }

    const isSelf = String(currentUser.id) === String(profileId);

    // Own profile always loads via /users/me/ (richer — onboarding status,
    // date of birth for self-edit) — fetched in parallel with memberships
    // since self access never depends on the membership result. A non-self
    // view has no such endpoint; MembershipFullResponse.user already carries
    // everything the read-only sections below need, so tournament-memberships
    // alone is enough — an empty result there means no shared tournament,
    // i.e. no access.
    if (isSelf) usersApi.meFull().then(setProfile).catch(() => setError("Failed to load profile."));

    usersApi.tournamentMemberships(profileId)
      .then((ms) => {
        setMemberships(ms);
        if (!isSelf) {
          if (ms.length > 0) setProfile(ms[0].user);
          else setAccessDenied(true);
        }
      })
      .catch(() => setError("Failed to load profile."));

    canonicalEventsApi.list().then(setEvents).catch(() => {});
  }, [authLoading, currentUser, profileId, router]);

  // One fetch per unique tournament — needed for the age-disclosure banner's
  // collect_is_over_18/21 (not on MembershipFullResponse) regardless of
  // membership count, and doubles as the section-heading name when there's
  // more than one membership to tell apart.
  useEffect(() => {
    if (memberships.length === 0) return;
    const uniqueIds = Array.from(new Set(memberships.map((m) => m.tournament_id)));
    Promise.all(uniqueIds.map((id) => tournamentsApi.get(id).catch(() => null)))
      .then((results) => {
        const byId: Record<number, Tournament> = {};
        results.forEach((t, i) => { if (t) byId[uniqueIds[i]] = t; });
        setTournaments(byId);
      });
  }, [memberships]);

  // ── Competition experience CRUD (fast-edit, "view-edit" mode) ──────────────
  function draftToCompetitionCreate(row: CompetitionExperienceDraft) {
    return {
      event_id: row.event_id as number,
      school: row.school,
      notes: row.notes || null,
    };
  }

  async function handleAddCompetition(row: CompetitionExperienceDraft): Promise<CompetitionExperienceDraft> {
    const created: CompetitionExperience = await usersApi.addCompetitionExperience(draftToCompetitionCreate(row));
    setProfile(p => p ? { ...p, competition_experience: [...p.competition_experience, created] } : p);
    return { id: created.id, school: created.school, event_id: created.event.id, event_name: created.event.name, notes: created.notes ?? '' };
  }

  async function handleUpdateCompetition(id: number, row: CompetitionExperienceDraft): Promise<CompetitionExperienceDraft> {
    const updated: CompetitionExperience = await usersApi.updateCompetitionExperience(id, draftToCompetitionCreate(row));
    setProfile(p => p ? {
      ...p,
      competition_experience: p.competition_experience.map(exp => exp.id === id ? updated : exp),
    } : p);
    return { id: updated.id, school: updated.school, event_id: updated.event.id, event_name: updated.event.name, notes: updated.notes ?? '' };
  }

  async function handleDeleteCompetition(id: number): Promise<void> {
    await usersApi.deleteCompetitionExperience(id);
    setProfile(p => p ? {
      ...p,
      competition_experience: p.competition_experience.filter(exp => exp.id !== id),
    } : p);
  }

  // ── Volunteer experience CRUD (fast-edit, "view-edit" mode) ─────────────────
  function draftToVolunteerCreate(row: VolunteerExperienceDraft) {
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

  async function handleAddVolunteer(row: VolunteerExperienceDraft): Promise<VolunteerExperienceDraft> {
    const created: VolunteerExperience = await usersApi.addVolunteerExperience(draftToVolunteerCreate(row));
    setProfile(p => p ? { ...p, volunteer_experience: [...p.volunteer_experience, created] } : p);
    return {
      id: created.id, tournament_name: created.tournament_name, year: String(created.year),
      event_id: created.event?.id ?? null, event_name: created.event?.name ?? created.notes?.event ?? '',
      role: created.role, notes_other: created.notes?.other ?? '',
    };
  }

  async function handleUpdateVolunteer(id: number, row: VolunteerExperienceDraft): Promise<VolunteerExperienceDraft> {
    const updated: VolunteerExperience = await usersApi.updateVolunteerExperience(id, draftToVolunteerCreate(row));
    setProfile(p => p ? {
      ...p,
      volunteer_experience: p.volunteer_experience.map(exp => exp.id === id ? updated : exp),
    } : p);
    return {
      id: updated.id, tournament_name: updated.tournament_name, year: String(updated.year),
      event_id: updated.event?.id ?? null, event_name: updated.event?.name ?? updated.notes?.event ?? '',
      role: updated.role, notes_other: updated.notes?.other ?? '',
    };
  }

  async function handleDeleteVolunteer(id: number): Promise<void> {
    await usersApi.deleteVolunteerExperience(id);
    setProfile(p => p ? {
      ...p,
      volunteer_experience: p.volunteer_experience.filter(exp => exp.id !== id),
    } : p);
  }

  if (authLoading || (!profile && !error && !accessDenied)) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div style={{ padding: "40px", fontFamily: "var(--font-sans)", color: "var(--color-text-tertiary)" }}>
        You don&apos;t have access to view this profile.
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ padding: "40px", fontFamily: "var(--font-sans)", color: "var(--color-text-tertiary)" }}>
        {error ?? "Profile not found."}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)" }}>
      <Topbar showWordmark showAvatar />
      <div style={{
        maxWidth: "900px", margin: "0 auto", padding: "32px 20px",
        display: "flex", flexDirection: "column", gap: "20px",
      }}>
        <ProfileHeader user={profile} showEditButton={isOwnProfile} />

        {memberships.map((m) => (
          <MembershipTournamentSections
            key={m.id}
            membership={m}
            tournament={tournaments[m.tournament_id]}
            tournamentName={memberships.length > 1 ? tournaments[m.tournament_id]?.name : undefined}
          />
        ))}

        <ProfileCard><EducationCareerSection user={profile} /></ProfileCard>
        {profile.has_competition_experience !== false && (
          <ProfileCard>
            <CompetitionExperienceSection
              user={profile}
              mode={isOwnProfile ? "view-edit" : "view"}
              events={events}
              onAdd={handleAddCompetition}
              onUpdate={handleUpdateCompetition}
              onDelete={handleDeleteCompetition}
            />
          </ProfileCard>
        )}

        {profile.has_volunteer_experience !== false && (
          <ProfileCard>
            <VolunteerExperienceSection
              user={profile}
              mode={isOwnProfile ? "view-edit" : "view"}
              events={events}
              onAdd={handleAddVolunteer}
              onUpdate={handleUpdateVolunteer}
              onDelete={handleDeleteVolunteer}
            />
          </ProfileCard>
        )}
        <ProfileCard><LogisticsSection user={profile} /></ProfileCard>
      </div>
      {currentUser?.id === profile.id && (
        <FloatingEditButton profileId={profile.id} />
      )}
    </div>
  );
}