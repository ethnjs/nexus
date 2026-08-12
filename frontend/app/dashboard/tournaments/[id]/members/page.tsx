"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { membershipsApi, rolesApi, MembershipSlim, Role, ApiError } from "@/lib/api";
import { personName } from "@/lib/personDisplay";
import { formatPhone } from "@/lib/auth";
import { formatDuration } from "@/lib/timeFormat";
import { useAuth } from "@/lib/useAuth";
import { useMyMembership } from "@/lib/useMyMembership";
import { useToast } from "@/lib/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ChipInput } from "@/components/ui/ChipInput";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { AvatarCircle } from "@/components/ui/AvatarCircle";
import { HoverCard } from "@/components/ui/HoverCard";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconLock, IconPlus } from "@/components/ui/Icons";

// Name / Email / Phone / Account Age / Join Date / Join Method / Status / Roles
const MEMBER_ROW_COLUMNS = "1fr 1.2fr 0.8fr 90px 90px 110px 90px 2.2fr";

const SOURCE_LABELS: Record<string, string> = {
  join_code: "Invite",
  public: "Public",
  manual: "Manual",
};

const STATUS_VARIANT: Record<string, "interested" | "confirmed"> = {
  interested: "interested",
  confirmed: "confirmed",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DurationCell({ iso }: { iso: string }) {
  return (
    <span style={{ justifySelf: "center" }}>
      <Tooltip variant="info" message={fmtDate(iso)} showIcon={false}>
        <span
          style={{
            fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
            cursor: "default",
          }}
        >
          {formatDuration(iso)}
        </span>
      </Tooltip>
    </span>
  );
}

function JoinMethodCell({ membership }: { membership: MembershipSlim }) {
  if (membership.source !== "join_code" || !membership.join_code) {
    return (
      <Badge variant="default" style={{ justifySelf: "center" }}>
        {SOURCE_LABELS[membership.source] ?? membership.source}
      </Badge>
    );
  }

  const jc = membership.join_code;
  return (
    <HoverCard
      style={{ justifySelf: "center" }}
      content={
        <>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
            {jc.label ?? "Invite"}
          </p>
          <p style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
            {jc.code}
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
            Invited by {personName(jc.creator)}
          </p>
        </>
      }
    >
      <Badge variant="default">Invite</Badge>
    </HoverCard>
  );
}

function RolesCell({
  tournamentId, membership, allRoles, canAssignRole, onUpdated,
}: {
  tournamentId: number;
  membership: MembershipSlim;
  allRoles: Role[];
  canAssignRole: (role: Role) => boolean;
  onUpdated: (updated: MembershipSlim) => void;
}) {
  const { show } = useToast();
  const memberName = personName(membership.user);

  const heldIds = new Set(membership.roles.map((r) => r.id));
  const pickableRoles = allRoles.filter((r) => canAssignRole(r));

  async function handleRemove(role: Role) {
    try {
      const updated = await membershipsApi.updateRoles(tournamentId, membership.id, { remove: [role.id] });
      onUpdated(updated);
      show(`Removed ${role.label} from ${memberName}`);
    } catch (err: unknown) {
      show(err instanceof ApiError ? err.message : "Failed to remove role.", "error");
    }
  }

  async function handleAdd(role: Role) {
    const updated = await membershipsApi.updateRoles(tournamentId, membership.id, { add: [role.id] });
    onUpdated(updated);
    show(`Added ${role.label} to ${memberName}`);
  }

  return (
    <ChipInput
      value={membership.roles.map((r) => r.label)}
      onChange={(labels) => {
        const removed = membership.roles.find((r) => !labels.includes(r.label));
        if (removed) handleRemove(removed);
      }}
      variant="transparent"
      size="sm"
      disableInput
      fullWidth
      addButton={
        <Popover
          trigger={
            <Button
              type="button" variant="secondary" size="sm" iconOnly
              title="Edit roles"
              style={{ padding: 0, flexShrink: 0 }}
            >
              <IconPlus size={14} />
            </Button>
          }
          items={pickableRoles}
          getKey={(role) => role.id}
          renderLabel={(role) => role.label}
          checklist
          isSelected={(role) => heldIds.has(role.id)}
          onSelect={(role) => (heldIds.has(role.id) ? handleRemove(role) : handleAdd(role))}
          emptyMessage="No assignable roles"
        />
      }
    />
  );
}

function MemberRow({
  tournamentId, membership, allRoles, canAssignRole, onUpdated, isLast,
}: {
  tournamentId: number;
  membership: MembershipSlim;
  allRoles: Role[];
  canAssignRole: (role: Role) => boolean;
  onUpdated: (updated: MembershipSlim) => void;
  isLast: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const { user } = membership;
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "—";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "grid", gridTemplateColumns: MEMBER_ROW_COLUMNS, alignItems: "center",
        gap: "10px", padding: "10px 12px",
        borderBottom: isLast ? "none" : "1px solid var(--color-border)",
        background: hovered ? "var(--color-bg)" : "transparent",
        transition: "background 100ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        <AvatarCircle user={user} size="sm" />
        <span style={{
          fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name}
        </span>
      </div>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {user.email}
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)" }}>
        {user.phone ? formatPhone(user.phone) : "—"}
      </span>
      <DurationCell iso={user.created_at} />
      <DurationCell iso={membership.created_at} />
      <JoinMethodCell membership={membership} />
      <Badge variant={STATUS_VARIANT[membership.status] ?? "default"} style={{ justifySelf: "center" }}>
        {membership.status}
      </Badge>
      <RolesCell
        tournamentId={tournamentId}
        membership={membership}
        allRoles={allRoles}
        canAssignRole={canAssignRole}
        onUpdated={onUpdated}
      />
    </div>
  );
}

export default function MembersPage() {
  const params = useParams();
  const tournamentId = Number(params.id);

  const { user: currentUser } = useAuth();
  const { membership, hasPermission, loading: membershipLoading } = useMyMembership();
  const canManageMembers = currentUser?.role === "admin" || !!membership?.is_owner || hasPermission("manage_members");
  const isAdmin = currentUser?.role === "admin";
  const isOwner = !!membership?.is_owner;

  const [members, setMembers] = useState<MembershipSlim[] | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManageMembers) return;
    membershipsApi.list(tournamentId)
      .then(setMembers)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Failed to load members."));
    rolesApi.list(tournamentId).then(setAllRoles).catch(() => setAllRoles([]));
  }, [tournamentId, canManageMembers]);

  // Lower rank number = more authority. A non-admin/owner can only assign
  // roles strictly below their own highest-authority role — same rule the
  // backend enforces (validate_role_action), so this just keeps the "+"
  // picker from ever offering something that would 403.
  const ownRank = useMemo(() => {
    if (!membership || membership.roles.length === 0) return null;
    return Math.min(...membership.roles.map((r) => r.rank));
  }, [membership]);

  function canAssignRole(role: Role): boolean {
    if (isAdmin || isOwner) return true;
    if (ownRank === null) return false;
    return role.rank > ownRank;
  }

  function handleMemberUpdated(updated: MembershipSlim) {
    setMembers((prev) => prev && prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  if (membershipLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!canManageMembers) {
    return (
      <div>
        <PageHeader heading="Members" />
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState
            icon={<IconLock size={28} />}
            title="No access"
            description="You need the manage members permission to view this page."
          />
        </Card>
      </div>
    );
  }

  if (members === null) {
    return (
      <div>
        <PageHeader heading="Members" />
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader heading="Members" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      {members.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px" }}>
          <EmptyState title="No members yet" description="Members who join this tournament will show up here." />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <div style={{
            display: "grid", gridTemplateColumns: MEMBER_ROW_COLUMNS, gap: "10px",
            padding: "12px 12px", fontFamily: "var(--font-sans)", fontSize: "11px",
            fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            color: "var(--color-text-tertiary)",
          }}>
            <span>Members — {members.length}</span>
            <span>Email</span>
            <span>Phone</span>
            <span style={{ textAlign: "center" }}>Account Age</span>
            <span style={{ textAlign: "center" }}>Joined</span>
            <span style={{ textAlign: "center" }}>Method</span>
            <span style={{ textAlign: "center" }}>Status</span>
            <span>Roles</span>
          </div>

          {members.map((m, i) => (
            <MemberRow
              key={m.id}
              tournamentId={tournamentId}
              membership={m}
              allRoles={allRoles}
              canAssignRole={canAssignRole}
              onUpdated={handleMemberUpdated}
              isLast={i === members.length - 1}
            />
          ))}
        </Card>
      )}
    </div>
  );
}
