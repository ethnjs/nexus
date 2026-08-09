"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { invitesApi, Invite, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { IconLock, IconPlus, IconTrash } from "@/components/ui/Icons";
import { CreateInviteModal } from "@/components/tournament/settings/CreateInviteModal";
import { AddTimePopover } from "@/components/tournament/settings/AddTimePopover";

// Label / Code / Creator / Expiry / Uses / Actions
const INVITE_ROW_COLUMNS = "1.2fr 120px 1.3fr 170px 60px 72px";

function creatorUser(creator: Invite["creator"]) {
  return "user" in creator ? creator.user : creator;
}

function creatorName(creator: Invite["creator"]) {
  const user = creatorUser(creator);
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email;
}

// Always ticks down to the second — "2d 4h 13m 45s" — never collapses away
// smaller units once a larger one is showing.
function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Expired";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  if (days > 0 || hours > 0 || minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function InviteRow({
  tournamentId, invite, now, isLast, onUpdated, onDeactivated,
}: {
  tournamentId: number;
  invite: Invite;
  now: number;
  isLast: boolean;
  onUpdated: (invite: Invite) => void;
  onDeactivated: (id: number) => void;
}) {
  const [deactivating, setDeactivating] = useState(false);
  const [hovered, setHovered] = useState(false);
  const user = creatorUser(invite.creator);
  const expiry = invite.expires_at === null
    ? "∞"
    : formatCountdown(new Date(invite.expires_at).getTime() - now);

  async function handleDeactivate() {
    setDeactivating(true);
    try {
      await invitesApi.deactivate(tournamentId, invite.id);
      onDeactivated(invite.id);
    } catch {
      setDeactivating(false);
    }
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid", gridTemplateColumns: INVITE_ROW_COLUMNS, alignItems: "center",
        gap: "8px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      <span style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {invite.label ?? "—"}
      </span>
      <Badge variant="default" className="font-mono" style={{ justifySelf: "center" }}>{invite.code}</Badge>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", minWidth: 0 }}>
        <AvatarCircle user={user} size="xs" />
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "13px",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {creatorName(invite.creator)}
        </span>
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {expiry}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }}>
        {invite.use_count}
      </span>
      <div style={{ display: "flex", justifyContent: "center", gap: "6px" }}>
        <AddTimePopover tournamentId={tournamentId} invite={invite} onUpdated={onUpdated} />
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Deactivate"
          loading={deactivating}
          onClick={handleDeactivate}
          style={{ width: "28px", height: "28px", padding: 0, color: "var(--color-danger)" }}
        >
          <IconTrash size={14} />
        </Button>
      </div>
    </div>
  );
}

function InviteTable({ invites, tournamentId, now, onUpdated, onDeactivated }: {
  invites: Invite[];
  tournamentId: number;
  now: number;
  onUpdated: (invite: Invite) => void;
  onDeactivated: (id: number) => void;
}) {
  return (
    <Card radius="lg" style={{ padding: "8px 12px", marginBottom: "16px" }}>
      <div style={{
        display: "grid", gridTemplateColumns: INVITE_ROW_COLUMNS,
        padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
        fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
      }}>
        <span>Invites — {invites.length}</span>
        <span style={{ textAlign: "center" }}>Code</span>
        <span style={{ textAlign: "center" }}>Creator</span>
        <span style={{ textAlign: "center" }}>Expiry</span>
        <span style={{ textAlign: "center" }}>Uses</span>
        <span />
      </div>

      {invites.map((invite, i) => (
        <InviteRow
          key={invite.id}
          tournamentId={tournamentId}
          invite={invite}
          now={now}
          isLast={i === invites.length - 1}
          onUpdated={onUpdated}
          onDeactivated={onDeactivated}
        />
      ))}
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
  const [creating, setCreating] = useState(false);

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

  function handleUpdated(updated: Invite) {
    setInvites((prev) => prev && prev.map((i) => (i.id === updated.id ? updated : i)));
  }

  function handleDeactivated(id: number) {
    setInvites((prev) => prev && prev.filter((i) => i.id !== id));
  }

  return (
    <div>
      <PageHeader
        heading="Invites"
        subheading="Tournament Settings"
        action={
          <Button type="button" variant="primary" size="md" onClick={() => setCreating(true)}>
            <IconPlus size={14} /> Add invite
          </Button>
        }
      />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {active.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            title="No invites yet"
            description="Create an invite to let members or staff join this tournament."
            action={
              <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
                <IconPlus size={14} /> Add invite
              </Button>
            }
          />
        </Card>
      ) : (
        <InviteTable
          invites={active}
          tournamentId={tournamentId}
          now={now}
          onUpdated={handleUpdated}
          onDeactivated={handleDeactivated}
        />
      )}

      {creating && (
        <CreateInviteModal
          tournamentId={tournamentId}
          onClose={() => setCreating(false)}
          onCreated={(invite) => setInvites((prev) => (prev ? [invite, ...prev] : [invite]))}
        />
      )}
    </div>
  );
}
