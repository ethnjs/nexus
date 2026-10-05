import { membersApi, type MembershipFull, type MemberRole } from "@/lib/api";

/** Where a role is held: the whole tournament, or a set of tracks. Never both —
 *  a tournament-wide grant already covers every track. */
export interface RoleScope {
  wide: boolean;
  trackIds: number[];
}

export const WIDE_SCOPE: RoleScope = { wide: true, trackIds: [] };
export const NO_SCOPE: RoleScope = { wide: false, trackIds: [] };

export function scopeOf(role: Pick<MemberRole, "is_tournament_wide" | "track_ids">): RoleScope {
  return role.is_tournament_wide
    ? WIDE_SCOPE
    : { wide: false, trackIds: [...(role.track_ids ?? [])].sort((a, b) => a - b) };
}

export function isEmptyScope(scope: RoleScope): boolean {
  return !scope.wide && scope.trackIds.length === 0;
}

/**
 * Moves one member's hold on one role from `from` to `to`.
 *
 * The API grants and revokes one scope per call, so a change is a few calls:
 * the additions go first so the role is never briefly held nowhere, then the
 * removals. Returns the last response, or null when nothing needed to change.
 * Granting is `from` = NO_SCOPE; revoking everywhere is `to` = NO_SCOPE.
 */
export async function changeRoleScope(
  tournamentId: number,
  membershipId: number,
  roleId: number,
  from: RoleScope,
  to: RoleScope,
): Promise<MembershipFull | null> {
  let latest: MembershipFull | null = null;
  const send = async (body: Parameters<typeof membersApi.updateRoles>[2]) => {
    latest = await membersApi.updateRoles(tournamentId, membershipId, body);
  };

  if (to.wide && !from.wide) await send({ add: [roleId], is_tournament_wide: true });
  if (!to.wide) {
    for (const trackId of to.trackIds.filter((id) => !from.trackIds.includes(id))) {
      await send({ add: [roleId], track_id: trackId });
    }
  }
  if (from.wide && !to.wide) await send({ remove: [roleId], is_tournament_wide: true });
  for (const trackId of from.trackIds) {
    if (to.wide || !to.trackIds.includes(trackId)) await send({ remove: [roleId], track_id: trackId });
  }
  return latest;
}
