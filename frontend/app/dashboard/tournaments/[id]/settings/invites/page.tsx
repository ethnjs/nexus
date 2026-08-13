"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { invitesApi, Invite, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { useTournament } from "@/lib/useTournament";
import { useMyMembership } from "@/lib/useMyMembership";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { HoverCard } from "@/components/ui/HoverCard";
import { IconArchive, IconLock, IconPlus, IconTrash } from "@/components/ui/Icons";
import { CreateInviteModal } from "@/components/tournament/settings/CreateInviteModal";
import { AddTimePopover } from "@/components/tournament/settings/AddTimePopover";
import { personUser, personName, personRoles } from "@/lib/personDisplay";
import { formatCountdown } from "@/lib/timeFormat";

// Label / Code / Creator / Expiry / Uses / Actions
const INVITE_ROW_COLUMNS = "1.2fr 120px 1.3fr 170px 60px 72px";

function EditableLabel({ tournamentId, invite, onUpdated }: {
  tournamentId: number;
  invite: Invite;
  onUpdated: (invite: Invite) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(invite.label ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    setValue(invite.label ?? "");
    setError(undefined);
    setEditing(true);
  }

  async function save() {
    const trimmed = value.trim();
    if (trimmed === (invite.label ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await invitesApi.update(tournamentId, invite.id, { label: trimmed || null });
      onUpdated(updated);
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to update label.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
        }}
        error={error}
        disabled={saving}
        size="xs"
        font="sans"
        fullWidth
      />
    );
  }

  return (
    <span
      onClick={startEdit}
      title="Click to edit label"
      style={{
        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {invite.label ?? "—"}
    </span>
  );
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
  const user = personUser(invite.creator);
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
      <EditableLabel tournamentId={tournamentId} invite={invite} onUpdated={onUpdated} />
      <Badge
        variant="default" className="font-mono"
        copyValue={`${typeof window !== "undefined" ? window.location.origin : ""}/join?code=${invite.code}`}
        title="Copy join link"
        style={{ justifySelf: "center" }}
      >
        {invite.code}
      </Badge>
      <HoverCard
        style={{ justifyContent: "center", justifySelf: "center", width: "100%" }}
        content={
          <>
            <p style={{
              fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {personName(invite.creator)}
            </p>
            <p style={{
              fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px",
            }}>
              {user.email}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
              {(() => {
                const roles = personRoles(invite.creator);
                if (roles === null) {
                  return (
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                      No membership in this tournament
                    </span>
                  );
                }
                if (roles.length === 0) {
                  return (
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                      No roles
                    </span>
                  );
                }
                return roles.map((role) => <Badge key={role.id} variant="default">{role.label}</Badge>);
              })()}
            </div>
          </>
        }
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", minWidth: 0, cursor: "default" }}>
          <AvatarCircle user={user} size="xs" />
          <span style={{
            fontFamily: "var(--font-sans)", fontSize: "13px",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {personName(invite.creator)}
          </span>
        </div>
      </HoverCard>
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
        display: "grid", gridTemplateColumns: INVITE_ROW_COLUMNS, gap: "8px",
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
  const { isArchived } = useTournament();
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
          <Button type="button" variant="primary" size="md" disabled={isArchived} onClick={() => setCreating(true)}>
            <IconPlus size={14} /> Add invite
          </Button>
        }
      />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
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
      ) : invites.length === 0 ? (
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
          invites={invites}
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
