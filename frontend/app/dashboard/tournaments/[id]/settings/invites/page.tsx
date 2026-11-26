"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CreatorHoverCard } from "@/components/tournament/CreatorHoverCard";
import { AddTimePopover } from "@/components/tournament/settings/AddTimePopover";
import { CreateInviteModal } from "@/components/tournament/settings/CreateInviteModal";
import { InviteEmailForm } from "@/components/tournament/settings/InviteEmailForm";
import { InviteRolesCell } from "@/components/tournament/settings/InviteRolesCell";
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
  IconMail,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal";
import table from "@/components/ui/Table.module.css";
import { TabStrip } from "@/components/ui/TabStrip";
import {
  ApiError,
  type Invite,
  type InviteEmailRecipient,
  invitesApi,
  type Role,
  rolesApi,
} from "@/lib/api";
import { personName } from "@/lib/personDisplay";
import { stickyHeader } from "@/lib/stickyHeader";
import { formatCountdown, formatDateTime } from "@/lib/timeFormat";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { useTournament } from "@/lib/useTournament";

// Label / Code / Roles / Creator / Expiry / Uses / Actions
const INVITE_ROW_COLUMNS = "1.2fr 120px 1.3fr 1.3fr 150px 60px 106px";
// Email / Invite / Sent by / Sent / Status
const EMAIL_ROW_COLUMNS = "1.6fr 1.2fr 1.3fr 170px 90px";

type Tab = "invites" | "emails";

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
  grantableRoles,
  onUpdated,
  onDeactivated,
  onEmail,
}: {
  tournamentId: number;
  invite: Invite;
  now: number;
  grantableRoles: Role[] | null;
  onUpdated: (invite: Invite) => void;
  onDeactivated: (id: number) => void;
  onEmail: (invite: Invite) => void;
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
      <InviteRolesCell
        tournamentId={tournamentId}
        invite={invite}
        grantableRoles={grantableRoles}
        onUpdated={onUpdated}
      />
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
        <Button
          type="button"
          variant="secondary"
          size="sm"
          iconOnly
          title="Send email"
          onClick={() => onEmail(invite)}
          style={{ width: "28px", height: "28px", padding: 0 }}
        >
          <IconMail size={13} />
        </Button>
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
  grantableRoles,
  onUpdated,
  onDeactivated,
  onEmail,
}: {
  invites: Invite[];
  tournamentId: number;
  now: number;
  grantableRoles: Role[] | null;
  onUpdated: (invite: Invite) => void;
  onDeactivated: (id: number) => void;
  onEmail: (invite: Invite) => void;
}) {
  return (
    <Card
      radius="lg"
      className={table.scroll}
      style={{ padding: "8px 12px", marginBottom: "16px" }}
    >
      <div className={table.table} style={{ gridTemplateColumns: INVITE_ROW_COLUMNS }}>
        <div ref={stickyHeader} className={table.header}>
          <span>Invites — {invites.length}</span>
          <span style={{ textAlign: "center" }}>Code</span>
          <span style={{ textAlign: "center" }}>Roles</span>
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
            grantableRoles={grantableRoles}
            onUpdated={onUpdated}
            onDeactivated={onDeactivated}
            onEmail={onEmail}
          />
        ))}
      </div>
    </Card>
  );
}

const CELL_TEXT = {
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  color: "var(--color-text-secondary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

function SentEmailsTable({ rows }: { rows: InviteEmailRecipient[] }) {
  return (
    <Card
      radius="lg"
      className={table.scroll}
      style={{ padding: "8px 12px", marginBottom: "16px" }}
    >
      <div className={table.table} style={{ gridTemplateColumns: EMAIL_ROW_COLUMNS }}>
        <div ref={stickyHeader} className={table.header}>
          <span>Sent emails — {rows.length}</span>
          <span style={{ textAlign: "center" }}>Invite</span>
          <span style={{ textAlign: "center" }}>Sent by</span>
          <span style={{ textAlign: "center" }}>Sent</span>
          <span style={{ textAlign: "center" }}>Status</span>
        </div>

        {rows.map((row) => (
          <div key={`${row.sent_at}-${row.email}`} className={table.row}>
            <span
              style={{
                ...CELL_TEXT,
                fontFamily: "var(--font-mono)",
                color: "var(--color-text-primary)",
              }}
            >
              {row.email}
            </span>
            <span style={{ ...CELL_TEXT, textAlign: "center" }}>
              {row.label ? `${row.label} (${row.join_code})` : row.join_code}
            </span>
            {row.sender.user_id === null ? (
              <span style={{ ...CELL_TEXT, textAlign: "center" }}>
                {row.sender_name ?? "Deleted user"}
              </span>
            ) : (
              <CreatorHoverCard
                creator={row.sender}
                noMembershipLabel="No membership in this tournament"
                style={{ justifyContent: "center", justifySelf: "center", width: "100%" }}
              />
            )}
            <span
              style={{
                ...CELL_TEXT,
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                textAlign: "center",
              }}
            >
              {formatDateTime(row.sent_at)}
            </span>
            <Badge
              variant={row.status === "sent" ? "confirmed" : "declined"}
              title={
                row.status === "sent"
                  ? "Accepted by the email provider. It can still bounce."
                  : "The email provider refused this address."
              }
              style={{ justifySelf: "center" }}
            >
              {row.status === "sent" ? "Sent" : "Failed"}
            </Badge>
          </div>
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
  const isOwnerOrAdmin = currentUser?.role === "admin" || !!membership?.is_owner;
  const canManageInvites = isOwnerOrAdmin || hasPermission("manage_invites");
  const canSetRoles = isOwnerOrAdmin || hasPermission("manage_members");

  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [emailing, setEmailing] = useState<Invite | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("invites");
  const [sentEmails, setSentEmails] = useState<InviteEmailRecipient[] | null>(null);
  const [grantableRoles, setGrantableRoles] = useState<Role[] | null>(null);

  useEffect(() => {
    if (!canManageInvites) return;
    invitesApi
      .list(tournamentId)
      .then(setInvites)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load invites."));
  }, [tournamentId, canManageInvites]);

  useEffect(() => {
    if (!canSetRoles) return;
    rolesApi
      .list(tournamentId)
      .then((roles) => setGrantableRoles(roles.filter((r) => r.permissions.length === 0)))
      .catch(() => setGrantableRoles(null));
  }, [tournamentId, canSetRoles]);

  function loadSentEmails() {
    invitesApi
      .listEmails(tournamentId)
      .then(setSentEmails)
      .catch((e) =>
        setLoadError(e instanceof ApiError ? e.message : "Failed to load sent emails."),
      );
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadSentEmails is recreated each render
  useEffect(() => {
    if (canManageInvites && tab === "emails" && sentEmails === null) loadSentEmails();
  }, [tab, canManageInvites, sentEmails]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (membershipLoading) {
    return <LoadingState />;
  }

  if (!canManageInvites) {
    return (
      <div>
        <SettingsPageHeader page="invites" heading="Invites" />
        <EmptyState
          card
          icon={<IconLock size={28} />}
          title="No access"
          description="You need the manage invites permission to view this page."
        />
      </div>
    );
  }

  if (invites === null) {
    return (
      <div>
        <SettingsPageHeader page="invites" heading="Invites" />
        <LoadingState />
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
      personName(i.creator).toLowerCase().includes(query) ||
      i.roles.some((r) => r.label.toLowerCase().includes(query)),
  );
  const filteredEmails = (sentEmails ?? []).filter(
    (r) =>
      r.email.toLowerCase().includes(query) ||
      (r.label ?? "").toLowerCase().includes(query) ||
      (r.join_code ?? "").toLowerCase().includes(query),
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

      <TabStrip
        tabs={[
          { key: "invites", label: "Invites" },
          { key: "emails", label: "Sent emails" },
        ]}
        activeKey={tab}
        onChange={setTab}
      />

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

      {tab === "emails" ? (
        sentEmails === null ? (
          <LoadingState />
        ) : sentEmails.length === 0 ? (
          <EmptyState
            card
            icon={<IconMail size={28} />}
            title="No emails sent yet"
            description="Use the mail button on an invite to email its join link."
          />
        ) : (
          <>
            <div style={{ marginBottom: "10px" }}>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch("")}
                placeholder="Search sent emails"
                icon={<IconSearch size={14} />}
                font="sans"
                variant="secondary"
                size="md"
                fullWidth
              />
            </div>
            <SentEmailsTable rows={filteredEmails} />
          </>
        )
      ) : isArchived ? (
        <EmptyState
          card
          icon={<IconArchive size={28} />}
          title="Tournament archived"
          description="Archiving deactivated every invite. Unarchive the tournament to create new ones."
        />
      ) : liveInvites.length === 0 ? (
        <EmptyState
          card
          icon={<IconInvite size={28} />}
          title="No invites yet"
          description="Create an invite to let members or staff join this tournament."
          action={
            <Button type="button" variant="primary" size="sm" onClick={() => setCreating(true)}>
              <IconPlus size={14} /> Add invite
            </Button>
          }
        />
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
            grantableRoles={grantableRoles}
            onUpdated={handleUpdated}
            onDeactivated={handleDeactivated}
            onEmail={setEmailing}
          />
        </>
      )}

      {creating && (
        <CreateInviteModal
          tournamentId={tournamentId}
          grantableRoles={grantableRoles}
          onClose={() => setCreating(false)}
          onCreated={(invite) => setInvites((prev) => (prev ? [invite, ...prev] : [invite]))}
        />
      )}

      {emailing && (
        <Modal title="Email invite" onClose={() => setEmailing(null)}>
          <InviteEmailForm
            tournamentId={tournamentId}
            inviteId={emailing.id}
            onClose={() => setEmailing(null)}
            onSent={() => setSentEmails(null)}
          />
        </Modal>
      )}
    </div>
  );
}
