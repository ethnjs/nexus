"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { joinApi, membersApi, JoinPreviewTournament, ApiError } from "@/lib/api";
import { parseLocalDate } from "@/lib/date";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Spinner } from "@/components/ui/Spinner";
import { IconCalendar, IconLocation } from "@/components/ui/Icons";

// Copy varies by which threshold(s) this tournament actually collects — a
// TD who only cares about 21+ shouldn't see 18+ language.
function ageDisclosureCopy(preview: JoinPreviewTournament): string {
  if (preview.collect_is_over_18 && preview.collect_is_over_21) {
    return "This tournament asks whether members are 18 or older and 21 or older.";
  }
  if (preview.collect_is_over_21) {
    return "This tournament asks whether members are 21 or older.";
  }
  return "This tournament asks whether members are 18 or older.";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center py-16 px-4">
      <section style={{
        background: "var(--color-surface)", padding: "48px 40px", borderRadius: "10px",
        display: "flex", flexDirection: "column", alignItems: "center",
        width: "100%", maxWidth: "min(480px, 90vw)", boxShadow: "var(--shadow-lg)",
      }}>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "40px", color: "var(--color-text-primary)", margin: "0 0 28px" }}>
          NEXUS
        </h1>
        {children}
      </section>
    </div>
  );
}

function TournamentFacts({ preview }: { preview: JoinPreviewTournament }) {
  const fmt = (d: string) =>
    parseLocalDate(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const dateRange = preview.end_date !== preview.start_date
    ? `${fmt(preview.start_date)} – ${fmt(preview.end_date)}`
    : fmt(preview.start_date);

  const place = preview.university?.name ?? preview.location;
  const year = parseLocalDate(preview.start_date).getFullYear();

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px", marginBottom: "28px" }}>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", textAlign: "center" }}>
        You&rsquo;re invited to join
      </p>
      <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "24px", color: "var(--color-text-primary)", textAlign: "center" }}>
        {year} {preview.name}
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "center", marginTop: "6px" }}>
        {place && (
          <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            <IconLocation />{place}
          </span>
        )}
        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
          <IconCalendar />{dateRange}
        </span>
      </div>

      <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", marginTop: "6px" }}>
        <Badge>{preview.state}</Badge>
        <Badge>{preview.level[0].toUpperCase() + preview.level.slice(1)}</Badge>
        {preview.division.map((d) => <Badge key={d}>{d}</Badge>)}
      </div>
    </div>
  );
}

function InvalidState() {
  return (
    <>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "18px", fontWeight: 600, color: "var(--color-text-primary)", textAlign: "center", marginBottom: "8px" }}>
        This invite is no longer valid
      </p>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        It may have expired or been deactivated. Ask whoever invited you for a new link.
      </p>
    </>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<Shell><Spinner size="lg" /></Shell>}>
      <JoinPageContent />
    </Suspense>
  );
}

function JoinPageContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "";
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [preview, setPreview] = useState<JoinPreviewTournament | "chapter" | null>(null);
  const [previewError, setPreviewError] = useState(false);

  const [membershipChecked, setMembershipChecked] = useState(false);
  const [alreadyMember, setAlreadyMember] = useState(false);

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | undefined>(undefined);

  // Explicit opt-in — never pre-checked, and reset whenever the invite
  // itself changes so a stale "yes" can't carry over to a different code.
  const [ageConsent, setAgeConsent] = useState(false);

  useEffect(() => {
    if (!code) { setPreviewError(true); return; }
    joinApi.preview(code)
      .then((res) => setPreview(res.type === "tournament" ? res : "chapter"))
      .catch(() => setPreviewError(true));
  }, [code]);

  useEffect(() => {
    if (authLoading || !user || !user.is_onboarding_complete) return;
    if (!preview || preview === "chapter") return;
    membersApi.getMe(preview.target_id, [])
      .then((me) => setAlreadyMember(me.id !== null))
      .catch(() => setAlreadyMember(false))
      .finally(() => setMembershipChecked(true));
  }, [authLoading, user, preview]);

  async function handleJoin() {
    setJoining(true);
    setJoinError(undefined);
    try {
      const result = await joinApi.redeem(code, ageConsent);
      router.replace(`/tournaments/${result.target_id}/onboarding`);
    } catch (err: unknown) {
      setJoinError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setJoining(false);
    }
  }

  const redirectParam = `?redirect=${encodeURIComponent(`/join?code=${code}`)}`;

  if (previewError) {
    return <Shell><InvalidState /></Shell>;
  }

  if (preview === null) {
    return <Shell><Spinner size="lg" /></Shell>;
  }

  if (preview === "chapter") {
    return (
      <Shell>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "18px", fontWeight: 600, color: "var(--color-text-primary)", textAlign: "center", marginBottom: "8px" }}>
          Chapter invites aren&rsquo;t supported yet
        </p>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-secondary)", textAlign: "center" }}>
          This invite is for a chapter, which NEXUS doesn&rsquo;t support joining yet.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <TournamentFacts preview={preview} />

      {authLoading ? (
        <Spinner size="lg" />
      ) : !user ? (
        <div style={{ width: "100%", display: "flex", gap: "10px" }}>
          <Button fullWidth variant="secondary" onClick={() => router.push(`/sign-up${redirectParam}`)}>
            Create account
          </Button>
          <Button fullWidth onClick={() => router.push(`/sign-in${redirectParam}`)}>
            Sign in
          </Button>
        </div>
      ) : !user.is_onboarding_complete ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", textAlign: "center" }}>
            You need to complete the required fields of onboarding first.
          </p>
          <Button fullWidth onClick={() => router.push(`/onboarding${redirectParam}`)}>
            Complete onboarding
          </Button>
        </div>
      ) : !membershipChecked ? (
        <Spinner size="lg" />
      ) : alreadyMember ? (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", textAlign: "center" }}>
            You&rsquo;re already a member of this tournament.
          </p>
          <Button fullWidth onClick={() => router.push(`/tournaments/${preview.target_id}/onboarding`)}>
            Continue onboarding
          </Button>
        </div>
      ) : (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", textAlign: "center" }}>
            Joining as {user.first_name ? `${user.first_name} ${user.last_name ?? ""}`.trim() : user.email}
          </p>

          {(preview.collect_is_over_18 || preview.collect_is_over_21) && (
            <label style={{
              display: "flex", alignItems: "flex-start", gap: "8px", width: "100%",
              padding: "12px", borderRadius: "8px", background: "var(--color-bg)", cursor: "pointer",
            }}>
              <span style={{ marginTop: "2px" }}>
                <Checkbox checked={ageConsent} onChange={setAgeConsent} />
              </span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                {ageDisclosureCopy(preview)} I consent to sharing this with the tournament.
                The tournament only sees whether I meet the threshold — my date of birth is never shared.
              </span>
            </label>
          )}

          <Button
            fullWidth
            loading={joining}
            disabled={(preview.collect_is_over_18 || preview.collect_is_over_21) && !ageConsent}
            onClick={handleJoin}
          >
            Confirm &amp; Join
          </Button>
          {(preview.collect_is_over_18 || preview.collect_is_over_21) && !ageConsent && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center" }}>
              You must consent to age disclosure to join this tournament.
            </p>
          )}
          {joinError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", textAlign: "center" }}>
              {joinError}
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}
