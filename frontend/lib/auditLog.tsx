import { ReactNode } from "react";
import { AuditLogEntry } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";

// Mirrors backend/app/core/tournament/audit.py's ALL_ACTIONS — kept in sync
// by hand since there's no shared codegen between the two.
export const ALL_AUDIT_ACTIONS = [
  "role_created",
  "role_updated",
  "role_deleted",
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
  /** True for system-triggered entries (e.g. the daily auto-archive job) — the logged actor_id isn't who actually did this, so the row shouldn't attribute it to them. */
  hideActor?: boolean;
}

function fmtDuration(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
}

function CodeBadge({ code }: { code: string }) {
  return <Badge variant="default" className="font-mono">{code}</Badge>;
}

function RoleBadge({ label }: { label: string }) {
  return <Badge variant="default">{label}</Badge>;
}

// Git-diff style: "+2 / -1" counts on one line, the actual added (green)/
// removed (red) permission badges on the line below.
function PermissionDiff({ added, removed }: { added: string[]; removed: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        Updated permissions
        <Badge variant="confirmed">+{added.length}</Badge>
        /
        <Badge variant="declined">-{removed.length}</Badge>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
        {added.map((p) => <Badge key={`+${p}`} variant="confirmed">+ {p}</Badge>)}
        {removed.map((p) => <Badge key={`-${p}`} variant="declined">- {p}</Badge>)}
      </div>
    </div>
  );
}

// One renderer per action, working off the extra_data shapes confirmed
// against every log_action() call site (see audit-log-conventions.md).
// extra_data is untyped JSON from the backend — cast per-field rather than
// validating strictly, same pragmatic trust already given elsewhere in
// this codebase to backend-shaped response data.
//
// Rank numbers are internal spacing (10/20/30, rebalanced on every reorder)
// — never surfaced to the user, here or anywhere else in these renderers.
const DESCRIBERS: Record<string, (extra: Record<string, unknown>, entry: AuditLogEntry) => AuditLogDescription> = {
  role_created: (e, entry) => ({
    summary: <>Created role <RoleBadge label={entry.role?.label ?? (e.label as string)} /></>,
  }),

  role_updated: (e, entry) => {
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
      // entry.role is the current row — always present for a single-role
      // update (only null for the bulk-reorder variant handled above).
      summary: entry.role
        ? <>Updated role <RoleBadge label={entry.role.label} /></>
        : "Updated a role",
      details: changes.map((c) => {
        if (c.field === "permissions") {
          return <PermissionDiff added={c.added ?? []} removed={c.removed ?? []} />;
        }
        if (c.field === "rank") return "Rank changed";
        if (c.field === "label") return `Renamed: ${c.old} → ${c.new}`;
        return `${c.field}: ${c.old} → ${c.new}`;
      }),
    };
  },

  role_deleted: (e) => ({
    // entry.role is always null here — the row is gone by the time this
    // logs, so extra_data's snapshot is the only source for its label.
    summary: (
      <>
        Deleted role <RoleBadge label={e.label as string} />
        {(e.members_affected as number) > 0 ? ` — ${e.members_affected} member${e.members_affected === 1 ? "" : "s"} affected` : ""}
      </>
    ),
  }),

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

  tournament_archived: (e) => (
    // The auto-archive job logs under the owner's actor_id (a real user row
    // is required), but they didn't take this action — don't attribute it.
    e?.auto_archived
      ? { summary: "Tournament was automatically archived after it ended", hideActor: true }
      : { summary: "Archived tournament" }
  ),

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
  return describe(entry.extra_data ?? {}, entry);
}
