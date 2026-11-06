"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CreatorHoverCard } from "@/components/tournament/CreatorHoverCard";
import { AddTimePopover } from "@/components/tournament/settings/AddTimePopover";
import { CreateInviteModal } from "@/components/tournament/settings/CreateInviteModal";
import { SettingsPageHeader } from "@/components/tournament/settings/SettingsPageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EditableText } from "@/components/ui/EditableText";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  IconArchive,
  IconInvite,
  IconLock,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import table from "@/components/ui/Table.module.css";
import { ApiError, type Invite, invitesApi } from "@/lib/api";
import { personName } from "@/lib/personDisplay";
import { formatCountdown } from "@/lib/timeFormat";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { useTournament } from "@/lib/useTournament";

// Label / Code / Creator / Expiry / Uses / Actions
const INVITE_ROW_COLUMNS = "1.2fr 120px 1.3fr 170px 60px 72px";

function EditableLabel({
  tournamentId,
  invite,
  onUpdated,
}: {
  tournamentId: number;
  invite: Invite;
  onUpdated: (invite: Invite) => void;
}) {
  return (
    <EditableText
      value={invite.label ?? ""}
      onSave={async (label) =>
        onUpdated(await invitesApi.update(tournamentId, invite.id, { label }))
      }
      textStyle={{
        fontFamily: "var(--font-sans)",
        fontSize: "13px",
        fontWeight: 500,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      title="Click to edit label"
    />
  );
}

function InviteRow({
  tournamentId,
  invite,
  now,
  onUpdated,
  onDeactivated,
}: {
  tournamentId: number;
  invite: Invite;
  now: number;
  onUpdated: (invite: Invite) => void;
  onDeactivated: (id: number) => void;
}) {
  const [deactivating, setDeactivating] = useState(false);
  const expiry =
    invite.expires_at === null ? "∞" : formatCountdown(new Date(invite.expires_at).getTime() - now);

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
    <div className={table.row}>
      <EditableLabel tournamentId={tournamentId} invite={invite} onUpdated={onUpdated} />
      <Badge
        variant="default"
        className="font-mono"
        copyValue={`${typeof window !== "undefined" ? window.location.origin : ""}/join?code=${invite.code}`}
        title="Copy join link"
        style={{ justifySelf: "center" }}
      >
        {invite.code}
      </Badge>
      <CreatorHoverCard
        creator={invite.creator}
        noMembershipLabel="No membership in this tournament"
        style={{ justifyContent: "center", justifySelf: "center", width: "100%" }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          textAlign: "center",
        }}
      >
        {expiry}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--color-text-secondary)",
          textAlign: "center",
        }}
      >
        {invite.use_count}
      </span>
      <div style={{ display: "flex", justifyContent: "center", gap: "6px" }}>
        <AddTimePopover tournamentId={tournamentId} invite={invite} onUpdated={onUpdated} />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconOnly
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

function InviteTable({
  invites,
  tournamentId,
  now,
  onUpdated,
  onDeactivated,
}: {
  invites: Invite[];
  tournamentId: number;
  now: number;
  onUpdated: (invite: Invite) => void;
  onDeactivated: (id: number) => void;
}) {
  return (
    <Card
      radius="lg"
      className={table.scroll}
      style={{ padding: "8px 12px", marginBottom: "16px" }}
    >
      <div className={table.table} style={{ gridTemplateColumns: INVITE_ROW_COLUMNS }}>
        <div className={table.header}>
          <span>Invites — {invites.length}</span>
          <span style={{ textAlign: "center" }}>Code</span>
          <span style={{ textAlign: "center" }}>Creator</span>
          <span style={{ textAlign: "center" }}>Expiry</span>
          <span style={{ textAlign: "center" }}>Uses</span>
          <span />
        </div>

        {invites.map((invite) => (
          <InviteRow
            key={invite.id}
            tournamentId={tournamentId}
            invite={invite}
            now={now}
            onUpdated={onUpdated}
            onDeactivated={onDeactivated}
          />
        ))}
      </div>
    </Card>
  );
}

export default function InvitesSettingsPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { isArchived } = useTournament();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageInvites =
    currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_invites");

  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!canManageInvites) return;
    invitesApi
      .list(tournamentId)
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
        <SettingsPageHeader page="invites" heading="Invites" />
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
        <SettingsPageHeader page="invites" heading="Invites" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  // The route already drops expired codes; this catches one whose countdown
  // runs out while the page is open.
  const liveInvites = invites.filter(
    (i) => i.expires_at === null || new Date(i.expires_at).getTime() > now,
  );
  const query = search.trim().toLowerCase();
  const filteredInvites = liveInvites.filter(
    (i) =>
      (i.label ?? "").toLowerCase().includes(query) ||
      i.code.toLowerCase().includes(query) ||
      personName(i.creator).toLowerCase().includes(query),
  );

  function handleUpdated(updated: Invite) {
    setInvites((prev) => prev?.map((i) => (i.id === updated.id ? updated : i)) ?? null);
  }

  function handleDeactivated(id: number) {
    setInvites((prev) => prev?.filter((i) => i.id !== id) ?? null);
  }

  return (
    <div>
      <SettingsPageHeader page="invites" heading="Invites" />

      {loadError && (
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-danger)",
            marginBottom: "10px",
          }}
        >
          {loadError}
        </p>
      )}

      {isArchived ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconArchive size={28} />}
            title="Tournament archived"
            description="Archiving deactivated every invite. Unarchive the tournament to create new ones."
          />
        </Card>
      ) : liveInvites.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconInvite size={28} />}
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
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
            <div style={{ flex: 1 }}>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch("")}
                placeholder="Search invites"
                icon={<IconSearch size={14} />}
                font="sans"
                variant="secondary"
                size="md"
                fullWidth
              />
            </div>
            <Button type="button" variant="primary" size="md" onClick={() => setCreating(true)}>
              <IconPlus size={14} /> Add invite
            </Button>
          </div>
          <InviteTable
            invites={filteredInvites}
            tournamentId={tournamentId}
            now={now}
            onUpdated={handleUpdated}
            onDeactivated={handleDeactivated}
          />
        </>
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
