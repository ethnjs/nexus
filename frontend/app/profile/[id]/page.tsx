"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { usersApi } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import type { UserMeFull } from "@/lib/api";
import { Topbar } from "@/components/layout/Topbar";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { EducationCareerSection } from "@/components/profile/EducationCareerSection";
import { CompetitionExperienceTableView, VolunteerExperienceTableView } from "@/components/profile/ExperienceTables";

export default function ProfilePage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const profileId = params.id as string;

  const [profile, setProfile] = useState<UserMeFull | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return; // wait for auth to resolve either way

    if (!currentUser) {
      router.replace("/"); // not logged in at all
      return;
    }

    if (String(currentUser.id) !== String(profileId)) {
      router.replace("/dashboard");
      return;
    }

    usersApi.meFull()
      .then(setProfile)
      .catch(() => setError("Failed to load profile."));
  }, [authLoading, currentUser, profileId, router]);

  if (authLoading || (!profile && !error)) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
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
        maxWidth: "800px", margin: "0 auto", padding: "32px 20px",
        display: "flex", flexDirection: "column", gap: "20px",
      }}>
        <ProfileCard><ProfileHeader user={profile} /></ProfileCard>
        <ProfileCard><EducationCareerSection user={profile} /></ProfileCard>
        {profile.has_competition_experience !== false && (
          <ProfileCard>
            <h3 style={{
              fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
              color: "var(--color-text-primary)", marginBottom: "16px",
            }}>
              Competition Experience
            </h3>
            <CompetitionExperienceTableView rows={profile.competition_experience} />
          </ProfileCard>
        )}

        {profile.has_volunteer_experience !== false && (
          <ProfileCard>
            <h3 style={{
              fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
              color: "var(--color-text-primary)", marginBottom: "16px",
            }}>
              Volunteer Experience
            </h3>
            <VolunteerExperienceTableView rows={profile.volunteer_experience} />
          </ProfileCard>
        )}
        {/* Shirt size / dietary card next */}
      </div>
    </div>
  );
}