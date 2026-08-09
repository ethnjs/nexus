"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { invitesApi, Invite, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { IconLock } from "@/components/ui/Icons";

// Label / Code / Creator / Expiry / Uses
const INVITE_ROW_COLUMNS = "1.2fr 110px 1.3fr 120px 70px";

function creatorUser(creator: Invite["creator"]) {
  return "user" in creator ? creator.user : creator;
}

function creatorName(creator: Invite["creator"]) {
  const user = creatorUser(creator);
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
}

// "2d 4h" / "3h 12m" / "5m 30s" / "12s" — collapses to the two biggest
// non-zero units so the column doesn't jitter in width as it ticks down.
function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Expired";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function InviteRow({ invite, now, isLast }: { invite: Invite; now: number; isLast: boolean }) {
  const user = creatorUser(invite.creator);
  const expiry = invite.expires_at === null
    ? "∞"
    : formatCountdown(new Date(invite.expires_at).getTime() - now);

  return (
    <div style={{
      display: "grid", gridTemplateColumns: INVITE_ROW_COLUMNS, alignItems: "center",
      gap: "8px", padding: "10px 12px",
      borderBottom: isLast ? "none" : "1px solid var(--color-border)",
    }}>
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {invite.label ?? "—"}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {invite.code}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <AvatarCircle user={user} size={22} />
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "13px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {creatorName(invite.creator)}
        </span>
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {expiry}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "right" }}>
        {invite.use_count}
      </span>
    </div>
  );
}

function InviteSection({ title, invites, now }: { title: string; invites: Invite[]; now: number }) {
  return (
    <Card radius="lg" style={{ padding: "8px 12px", marginBottom: "16px" }}>
      <div style={{
        display: "grid", gridTemplateColumns: INVITE_ROW_COLUMNS,
        padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
        fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
      }}>
        <span>{title} — {invites.length}</span>
        <span>Code</span>
        <span>Creator</span>
        <span>Expiry</span>
        <span style={{ textAlign: "right" }}>Uses</span>
      </div>

      {invites.length === 0 ? (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", padding: "4px 12px 12px" }}>
          None.
        </p>
      ) : (
        invites.map((invite, i) => (
          <InviteRow key={invite.id} invite={invite} now={now} isLast={i === invites.length - 1} />
        ))
      )}
    </Card>
  );
}

export default function InvitesSettingsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageInvites = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_invites");

  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!canManageInvites) return;
    invitesApi.list(tournamentId)
      .then(setInvites)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load invites."));
  }, [tournamentId, canManageInvites]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageInvites) {
    return (
      <div>
        <PageHeader heading="Invites" subheading="Tournament Settings" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage invites permission to view this page."
          />
        </Card>
      </div>
    );
  }

  if (invites === null) {
    return (
      <div>
        <PageHeader heading="Invites" subheading="Tournament Settings" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  const active = invites.filter((i) => i.is_active);
  const inactive = invites.filter((i) => !i.is_active);

  return (
    <div>
      <PageHeader heading="Invites" subheading="Tournament Settings" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {invites.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState title="No invites yet" description="Create an invite to let staff join this tournament." />
        </Card>
      ) : (
        <>
          <InviteSection title="Active" invites={active} now={now} />
          <InviteSection title="Inactive" invites={inactive} now={now} />
        </>
      )}
    </div>
  );
}
