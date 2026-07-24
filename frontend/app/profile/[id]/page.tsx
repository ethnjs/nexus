"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { usersApi } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import type { UserMeFull } from "@/lib/api";
import { Topbar } from "@/components/layout/Topbar";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { EducationCareerSection } from "@/components/profile/sections/EducationCareerSection";
import { CompetitionExperienceSection, VolunteerExperienceSection } from "@/components/profile/sections/ExperienceSections";
import { LogisticsSection } from "@/components/profile/sections/LogisticsSection";
import Link from "next/link";
import { IconEdit } from "@/components/ui/Icons";


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
            <CompetitionExperienceSection user={profile} />
          </ProfileCard>
        )}

        {profile.has_volunteer_experience !== false && (
          <ProfileCard>
            <VolunteerExperienceSection user={profile} />
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