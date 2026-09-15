"use client";

import { useEffect, useMemo, useState } from "react";
import { adminUsersApi, AdminUserSlim, ApiError } from "@/lib/api";
import { formatPhone } from "@/lib/auth";
import { formatDuration } from "@/lib/timeFormat";
import { useAuth } from "@/lib/useAuth";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { HoverCard } from "@/components/ui/HoverCard";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import {
  IconSearch, IconMembers, IconTrash, IconKey, IconLock, IconRestore,
  IconUserShield, IconUser, IconCheckCircle, IconXCircle,
} from "@/components/ui/Icons";
import { useSetLayoutPanel } from "@/lib/useLayoutPanel";
import { AdminUserPanel, ADMIN_USER_PANEL_WIDTH } from "@/components/admin/AdminUserPanel";
import { STATUS_VARIANT } from "@/components/admin/AccountBadges";
import { useActionToast } from "@/lib/useActionToast";
import table from "@/components/ui/Table.module.css";

// Every track carries a floor *and* an `fr` weight, so the slack on a wide
// display spreads across all seven in proportion to what they hold. Two `fr`
// columns among five fixed ones dumped it all into Name and Email; capping
// them instead just moved the gap to the right of Actions. The floor is what
// stops a narrow window squeezing a cell until it wraps — an `fr` alone
// shrinks to nothing.
const COLUMNS = [
  "minmax(190px, 1.4fr)", // name — avatar + gap eat ~36px before the name
  "minmax(200px, 1.6fr)", // email — the longest content, so the largest share
  "minmax(124px, 0.8fr)", // phone — widest formatted number is ~108px
  "minmax(92px, 0.6fr)",  // role — one badge
  "minmax(104px, 0.7fr)", // status — one badge
  "minmax(96px, 0.7fr)",  // joined
  // Sized to exactly what it holds: four sm iconOnly buttons are 28px square
  // (Button's sm height) with 4px gaps — 4*28 + 3*4. At that width "centred"
  // and "flush right" are the same thing, so the header sits over the buttons
  // and the track still ends at the card's right edge. An `fr` share here left
  // the buttons floating in a 250px track with the header adrift from them.
  "124px",                // actions — 4 * 28px buttons + 3 * 4px gaps
].join(" ");

const MIN_TABLE_WIDTH = 1030;

type RoleFilter = "all" | "admin" | "user";

const ROLE_OPTIONS = [
  { value: "all",   label: "All" },
  { value: "admin", label: "Admins" },
  { value: "user",  label: "Users" },
];

const NUM_CELL: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "12px",
  color: "var(--color-text-secondary)", textAlign: "center",
};

const TEXT_CELL: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
};

function userName(user: AdminUserSlim): string {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
}

function UserRow({ user, isSelf, isOpen, onOpen, onAction }: {
  user: AdminUserSlim;
  /** The account doing the looking — the backend refuses every one of these on yourself. */
  isSelf: boolean;
  /** This row is the one the panel is showing. */
  isOpen: boolean;
  onOpen: () => void;
  onAction: (kind: "lock" | "activate" | "promote" | "demote" | "reset" | "delete") => void;
}) {
  const isActive = user.status === "active";
  const selfTitle = "You can't do this to your own account";

  return (
    <div
      className={`${table.row} ${table.clickable}`}
      // Deliberately not dimmed. A dimmed row reads as "unavailable to you",
      // which is backwards here: a locked account is exactly the one an admin
      // needs to act on. The Status badge carries the state instead.
      data-active={isOpen ? "true" : undefined}
      onClick={onOpen}
      title="Open profile"
    >
      <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <AvatarCircle user={user} size="sm" />
        <span style={{ ...TEXT_CELL, color: "var(--color-text-primary)", fontWeight: 500 }}>
          {userName(user)}
        </span>
      </span>

      <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
        <span style={TEXT_CELL} title={user.email}>{user.email}</span>
        <span
          style={{
            display: "flex", flexShrink: 0,
            color: user.email_verified ? "var(--color-success)" : "var(--color-warning)",
          }}
          title={user.email_verified ? "Email verified" : "Email not verified"}
        >
          {user.email_verified ? <IconCheckCircle size={13} /> : <IconXCircle size={13} />}
        </span>
      </span>

      <span style={{ ...NUM_CELL, textAlign: "left" }}>
        {user.phone ? formatPhone(user.phone) : "—"}
      </span>

      <span style={{ display: "flex", justifyContent: "center" }}>
        <Badge variant={user.role === "admin" ? "admin" : "default"}>
          {user.role === "admin" ? "Admin" : "User"}
        </Badge>
      </span>

      <span style={{ display: "flex", justifyContent: "center" }}>
        <Badge variant={STATUS_VARIANT[user.status]}>{user.status}</Badge>
      </span>

      <HoverCard
        width="fit"
        style={{ justifyContent: "center", width: "100%" }}
        content={
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", whiteSpace: "nowrap" }}>
            Joined {new Date(user.created_at).toLocaleString("en-US", {
              weekday: "short", month: "short", day: "numeric", year: "numeric",
              hour: "numeric", minute: "2-digit",
            })}
          </span>
        }
      >
        <span style={{ ...NUM_CELL, borderBottom: "1px dotted var(--color-border-strong)", cursor: "help" }}>
          {formatDuration(user.created_at)} ago
        </span>
      </HoverCard>

      {/* Every one of these is refused on your own account server-side, so the
          row for the acting admin shows them disabled rather than letting a
          click come back a 400. */}
      <div
        style={{ display: "flex", justifyContent: "center", gap: "4px" }}
        onClick={(e) => e.stopPropagation()}
      >
        {isActive ? (
          <Button
            type="button" variant="secondary" size="sm" iconOnly
            disabled={isSelf} title={isSelf ? selfTitle : "Lock account"}
            onClick={() => onAction("lock")}
          >
            <IconLock size={13} />
          </Button>
        ) : (
          <Button
            type="button" variant="secondary" size="sm" iconOnly
            disabled={isSelf} title={isSelf ? selfTitle : "Restore to active"}
            onClick={() => onAction("activate")}
          >
            <IconRestore size={13} />
          </Button>
        )}

        {user.role === "admin" ? (
          <Button
            type="button" variant="secondary" size="sm" iconOnly
            disabled={isSelf} title={isSelf ? selfTitle : "Demote to user"}
            onClick={() => onAction("demote")}
          >
            <IconUser size={13} />
          </Button>
        ) : (
          <Button
            type="button" variant="secondary" size="sm" iconOnly
            disabled={isSelf} title={isSelf ? selfTitle : "Promote to admin"}
            onClick={() => onAction("promote")}
          >
            <IconUserShield size={13} />
          </Button>
        )}

        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Send password reset email"
          onClick={() => onAction("reset")}
        >
          <IconKey size={13} />
        </Button>

        <Button
          type="button" variant="secondary" size="sm" iconOnly
          disabled={isSelf} title={isSelf ? selfTitle : "Delete account"}
          onClick={() => onAction("delete")}
        >
          <IconTrash size={13} style={{ color: isSelf ? undefined : "var(--color-danger)" }} />
        </Button>
      </div>
    </div>
  );
}

type PendingAction =
  | { kind: "lock" | "activate" | "promote" | "demote" | "reset" | "delete"; user: AdminUserSlim };

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const run = useActionToast();
  const [users, setUsers] = useState<AdminUserSlim[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");

  const [panelUserId, setPanelUserId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const { setPanel, clearPanel } = useSetLayoutPanel();

  useEffect(() => {
    adminUsersApi.list()
      .then(setUsers)
      .catch((err: unknown) => {
        setUsers([]);
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load users.");
      });
  }, []);

  // The slot lives in the layout and would outlive this table otherwise.
  useEffect(() => clearPanel, [clearPanel]);

  const visible = useMemo(() => {
    const rows = users ?? [];
    const query = search.trim().toLowerCase();
    return rows.filter((u) => {
      if (role !== "all" && u.role !== role) return false;
      if (!query) return true;
      return (
        userName(u).toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query) ||
        (u.phone?.includes(query) ?? false)
      );
    });
  }, [users, search, role]);

  // Position in the *filtered* order, so the arrows step through what the
  // reader is actually looking at rather than the unfiltered list.
  const panelIndex = panelUserId === null ? -1 : visible.findIndex((u) => u.id === panelUserId);
  const prevUser = panelIndex > 0 ? visible[panelIndex - 1] : null;
  const nextUser = panelIndex >= 0 && panelIndex < visible.length - 1 ? visible[panelIndex + 1] : null;

  useEffect(() => {
    if (panelUserId === null) {
      clearPanel();
      return;
    }
    setPanel(
      <AdminUserPanel
        userId={panelUserId}
        onClose={() => setPanelUserId(null)}
        onPrev={() => prevUser && setPanelUserId(prevUser.id)}
        onNext={() => nextUser && setPanelUserId(nextUser.id)}
        hasPrev={prevUser !== null}
        hasNext={nextUser !== null}
      />,
      ADMIN_USER_PANEL_WIDTH,
    );
    // Re-registers when the neighbours change (a search narrowing the list
    // moves them) — LayoutPanelSlot only re-arms its open animation when the
    // panel goes absent->present, so this doesn't restart the slide.
  }, [panelUserId, prevUser, nextUser, setPanel, clearPanel]);

  function replaceRow(updated: AdminUserSlim) {
    setUsers((prev) => (prev ?? []).map((u) => (u.id === updated.id ? updated : u)));
  }

  function removeRows(ids: (number | string)[]) {
    setUsers((prev) => (prev ?? []).filter((u) => !ids.includes(u.id)));
    // A deleted user's panel has nothing left to show.
    if (panelUserId !== null && ids.includes(panelUserId)) setPanelUserId(null);
  }

  const isFiltered = search.trim() !== "" || role !== "all";

  return (
    <>
      <PageHeader heading="Users" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        <Input
          placeholder="Search name, email or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          icon={<IconSearch size={16} />}
          size="md"
          font="sans"
          variant="secondary"
          style={{ width: "420px" }}
        />
        <ButtonGroup
          options={ROLE_OPTIONS}
          value={role}
          onChange={(v) => setRole(v as RoleFilter)}
          size="md"
        />
      </div>

      {users === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <EmptyState
            icon={<IconMembers size={26} />}
            title={isFiltered ? "No matching users" : "No users yet"}
            description={isFiltered ? "Try adjusting your search or filter." : "Nobody has signed up."}
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px", overflowX: "auto" }}>
          <div
            className={table.table}
            style={{ gridTemplateColumns: COLUMNS, minWidth: `${MIN_TABLE_WIDTH}px` }}
          >
            <div className={table.header}>
              <span>Name</span>
              <span>Email</span>
              <span>Phone</span>
              <span style={{ textAlign: "center" }}>Role</span>
              <span style={{ textAlign: "center" }}>Status</span>
              <span style={{ textAlign: "center" }}>Joined</span>
              <span style={{ textAlign: "center" }}>Actions</span>
            </div>

            {visible.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={currentUser?.id === u.id}
                isOpen={panelUserId === u.id}
                onOpen={() => setPanelUserId(u.id)}
                onAction={(kind) => setPending({ kind, user: u })}
              />
            ))}
          </div>
        </Card>
      )}

      {pending?.kind === "lock" && (
        <ConfirmModal
          title="Lock account"
          confirmLabel="Lock account"
          description={
            <>
              Lock <strong>{userName(pending.user)}</strong>? They lose access immediately —
              every session they hold is ended and they can&rsquo;t sign in. Only an admin can
              undo this.
            </>
          }
          onConfirm={() => run(
            `${userName(pending.user)} locked`,
            () => adminUsersApi.updateRole(pending.user.id, { status: "locked" }).then(replaceRow),
          )}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "activate" && (
        <ConfirmModal
          title="Restore account"
          variant="primary"
          confirmLabel="Restore"
          description={
            <>
              Restore <strong>{userName(pending.user)}</strong> to active? They&rsquo;ll be able to
              sign in again with their existing password.
            </>
          }
          onConfirm={() => run(
            `${userName(pending.user)} restored`,
            () => adminUsersApi.updateRole(pending.user.id, { status: "active" }).then(replaceRow),
          )}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "promote" && (
        <ConfirmModal
          title="Promote to admin"
          confirmLabel="Promote"
          description={
            <>
              Make <strong>{userName(pending.user)}</strong> a platform admin? They&rsquo;ll be
              able to see and act on every tournament, account and event on the platform,
              including this page.
            </>
          }
          onConfirm={() => run(
            `${userName(pending.user)} is now an admin`,
            () => adminUsersApi.updateRole(pending.user.id, { role: "admin" }).then(replaceRow),
          )}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "demote" && (
        <ConfirmModal
          title="Demote to user"
          variant="primary"
          confirmLabel="Demote"
          description={
            <>
              Remove admin from <strong>{userName(pending.user)}</strong>? They keep their
              per-tournament roles and lose platform-wide access.
            </>
          }
          onConfirm={() => run(
            `${userName(pending.user)} is no longer an admin`,
            () => adminUsersApi.updateRole(pending.user.id, { role: "user" }).then(replaceRow),
          )}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "reset" && (
        <ConfirmModal
          title="Send password reset"
          variant="primary"
          confirmLabel="Send email"
          description={
            <>
              Email a password reset link to <strong>{pending.user.email}</strong>? Their current
              password keeps working until they use it.
            </>
          }
          onConfirm={() => run(
            `Password reset sent to ${pending.user.email}`,
            () => adminUsersApi.sendPasswordReset(pending.user.id),
          )}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "delete" && (
        <BulkDeleteModal
          items={[pending.user]}
          noun="account"
          description={
            <>
              Delete <strong>{userName(pending.user)}</strong> ({pending.user.email})? This
              destroys their profile, experience records and every tournament membership they
              hold. This can&rsquo;t be undone — lock the account instead if you only need to cut
              off access.
            </>
          }
          onDelete={(u) => run(`${userName(u)} deleted`, () => adminUsersApi.delete(u.id))}
          onClose={() => setPending(null)}
          onDeleted={removeRows}
        />
      )}
    </>
  );
}
