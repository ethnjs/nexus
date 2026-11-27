"use client";

import { Badge } from "@/components/ui/Badge";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { IconWarning } from "@/components/ui/Icons";
import { type Invite, type InviteRole, invitesApi, type Role } from "@/lib/api";

interface InviteRolesCellProps {
  tournamentId: number;
  invite: Invite;
  /** Roles the invite may grant, or null when the viewer can't change roles. */
  grantableRoles: Role[] | null;
  onUpdated: (invite: Invite) => void;
}

function RoleBadge({ role }: { role: InviteRole }) {
  if (!role.has_permissions) return <Badge>{role.label}</Badge>;
  return (
    <Badge
      variant="warning"
      title="This role now has permissions, so people who join with this invite don't get it. Remove it from the invite or assign it by hand."
      style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
    >
      <IconWarning size={11} />
      {role.label}
    </Badge>
  );
}

export function InviteRolesCell({
  tournamentId,
  invite,
  grantableRoles,
  onUpdated,
}: InviteRolesCellProps) {
  const badges = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "4px",
        minHeight: "22px",
        alignItems: "center",
      }}
    >
      {invite.roles.length === 0 ? (
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--color-text-tertiary)",
          }}
        >
          None
        </span>
      ) : (
        invite.roles.map((role) => <RoleBadge key={role.id} role={role} />)
      )}
    </div>
  );

  if (!grantableRoles) return badges;

  const heldIds = new Set(invite.roles.map((r) => r.id));
  // A role that gained permissions stays listed so it can be unticked.
  const items: { id: number; label: string }[] = [
    ...grantableRoles.map((r) => ({ id: r.id, label: r.label })),
    ...invite.roles.filter((r) => r.has_permissions),
  ];

  return (
    <ChecklistPopover
      trigger={
        <button
          type="button"
          title="Change roles"
          style={{
            width: "100%",
            padding: "2px 0",
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {badges}
        </button>
      }
      items={items}
      getKey={(role) => String(role.id)}
      renderLabel={(role) => role.label}
      emptyMessage="No roles without permissions yet"
      isSelected={(role) => heldIds.has(role.id)}
      onToggle={async (role) => {
        const next = heldIds.has(role.id)
          ? [...heldIds].filter((id) => id !== role.id)
          : [...heldIds, role.id];
        onUpdated(await invitesApi.update(tournamentId, invite.id, { role_ids: next }));
      }}
    />
  );
}
