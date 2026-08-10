import { ReactNode } from "react";
import { AuditLogEntry } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";

// Mirrors backend/app/core/tournament/audit.py's ALL_ACTIONS — kept in sync
// by hand since there's no shared codegen between the two.
export const ALL_AUDIT_ACTIONS = [
  "role_created",
  "role_updated",
  "role_deleted",
  "membership_roles_updated",
  "join_code_created",
  "join_code_updated",
  "join_code_deactivated",
  "staff_invite_sent",
  "tournament_verified",
  "tournament_archived",
  "tournament_unarchived",
  "ownership_transferred",
] as const;

// "join_code_*" stays the backend/wire action name — display text says
// "invite" per the frontend's join-code -> invite rename.
export const ACTION_LABELS: Record<string, string> = {
  role_created: "Role created",
  role_updated: "Role updated",
  role_deleted: "Role deleted",
  membership_roles_updated: "Member roles updated",
  join_code_created: "Invite created",
  join_code_updated: "Invite updated",
  join_code_deactivated: "Invite deactivated",
  staff_invite_sent: "Staff invite sent",
  tournament_verified: "Verification changed",
  tournament_archived: "Tournament archived",
  tournament_unarchived: "Tournament unarchived",
  ownership_transferred: "Ownership transferred",
};

export interface AuditLogDescription {
  summary: ReactNode;
  /** Present only for multi-field/list entries — UI shows a chevron to expand into these lines. */
  details?: ReactNode[];
}

function fmtDuration(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
}

function CodeBadge({ code }: { code: string }) {
  return <Badge variant="default" className="font-mono">{code}</Badge>;
}

// One renderer per action, working off the extra_data shapes confirmed
// against every log_action() call site (see audit-log-conventions.md).
// extra_data is untyped JSON from the backend — cast per-field rather than
// validating strictly, same pragmatic trust already given elsewhere in
// this codebase to backend-shaped response data.
//
// Rank numbers are internal spacing (10/20/30, rebalanced on every reorder)
// — never surfaced to the user, here or anywhere else in these renderers.
const DESCRIBERS: Record<string, (extra: Record<string, unknown>) => AuditLogDescription> = {
  role_created: (e) => ({
    summary: <>Created role &quot;{e.label as string}&quot;</>,
  }),

  role_updated: (e) => {
    if (Array.isArray(e.bulk_reorder)) {
      const rows = e.bulk_reorder as { role_id: number; label: string; old: number; new: number }[];
      // The affected-row count is a rebalance side effect, not the size of
      // what the TD actually did (moving one role into a tie group can
      // renumber a dozen siblings) — so the summary doesn't claim a count,
      // just names which roles moved; specifics live in the detail list.
      return {
        summary: "Reordered roles",
        details: rows.map((r) => r.label),
      };
    }
    const changes = (e.changes as { field: string; old?: unknown; new?: unknown; added?: string[]; removed?: string[] }[]) ?? [];
    return {
      summary: "Updated a role",
      details: changes.map((c) => {
        if (c.field === "permissions") return `Permissions: +${c.added?.join(", ") || "none"} / -${c.removed?.join(", ") || "none"}`;
        if (c.field === "rank") return "Rank changed";
        return `${c.field}: ${c.old} → ${c.new}`;
      }),
    };
  },

  role_deleted: (e) => ({
    summary: (
      <>
        Deleted role &quot;{e.label as string}&quot;
        {(e.members_affected as number) > 0 ? ` — ${e.members_affected} member${e.members_affected === 1 ? "" : "s"} affected` : ""}
      </>
    ),
  }),

  membership_roles_updated: (e) => {
    const added = (e.added as string[]) ?? [];
    const removed = (e.removed as string[]) ?? [];
    const details: string[] = [];
    if (added.length > 0) details.push(`Added: ${added.join(", ")}`);
    if (removed.length > 0) details.push(`Removed: ${removed.join(", ")}`);
    return { summary: "Updated member roles", details };
  },

  join_code_created: (e) => {
    const details: string[] = [];
    if (e.label) details.push(`Label: ${e.label as string}`);
    const hours = e.expires_in_hours as number | null;
    details.push(hours === null ? "Never expires" : `Expires in ${fmtDuration(hours)}`);
    return {
      summary: <>Created invite <CodeBadge code={e.code as string} /></>,
      details,
    };
  },

  join_code_updated: (e) => {
    const details: string[] = [];
    const changes = e.changes as { label?: { old: string | null; new: string | null } } | undefined;
    if (changes?.label) details.push(`Label: ${changes.label.old ?? "—"} → ${changes.label.new ?? "—"}`);
    if (typeof e.add_hours === "number") details.push(`Extended by ${e.add_hours}h`);
    return { summary: "Updated an invite", details: details.length > 0 ? details : undefined };
  },

  join_code_deactivated: (e) => ({
    summary: <>Deactivated invite <CodeBadge code={e.code as string} /></>,
  }),

  staff_invite_sent: (e) => {
    const emails = (e.emails as string[]) ?? [];
    const failed = new Set((e.failed as string[]) ?? []);
    return {
      summary: (
        <>
          Sent {emails.length} staff invite{emails.length === 1 ? "" : "s"} via <CodeBadge code={e.join_code as string} />
          {failed.size > 0 ? ` (${failed.size} failed)` : ""}
        </>
      ),
      details: emails.map((email) => (failed.has(email) ? `✗ ${email} — failed` : email)),
    };
  },

  tournament_verified: (e) => ({
    summary: e.is_verified ? "Marked tournament verified" : "Marked tournament unverified",
  }),

  tournament_archived: (e) => ({
    summary: e?.auto_archived ? "Tournament auto-archived" : "Archived tournament",
  }),

  tournament_unarchived: () => ({
    summary: "Unarchived tournament",
  }),

  ownership_transferred: (e) => {
    const oldOwner = e.old as { name: string };
    const newOwner = e.new as { name: string };
    return { summary: `Transferred ownership from ${oldOwner.name} to ${newOwner.name}` };
  },
};

export function describeAuditLogEntry(entry: AuditLogEntry): AuditLogDescription {
  const describe = DESCRIBERS[entry.action];
  if (!describe) return { summary: entry.action };
  return describe(entry.extra_data ?? {});
}
