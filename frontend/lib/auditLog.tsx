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

/** One tier of a hierarchy: the roles that sat at the same rank, i.e. tied with each other. */
type RoleTier = string[];

const TIER_LABEL_STYLE = {
  fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-tertiary)",
} as const;

// One side of the order diff: tiers top-to-bottom, each prefixed by its
// position number. Tied roles share a number, which is what communicates
// "these are equal" without ever printing a rank value.
function RoleOrderColumn({
  heading, tiers, movers, moverVariant,
}: { heading: string; tiers: RoleTier[]; movers: Set<string>; moverVariant: "declined" | "confirmed" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px", minWidth: 0 }}>
      <span style={TIER_LABEL_STYLE}>{heading}</span>
      {tiers.map((labels, i) => (
        <div key={i} style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: "11px", lineHeight: "18px",
            color: "var(--color-text-tertiary)", flexShrink: 0,
          }}>
            {i + 1}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", minWidth: 0 }}>
            {labels.map((label) => (
              <Badge key={label} variant={movers.has(label) ? moverVariant : "default"}>{label}</Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Before on the left, after on the right, with the tiers numbered on each
// side so the change reads as a position swap. Only the moved roles are
// colored (red where they left, green where they landed) — coloring every
// badge would imply every role was touched, when the rest are just
// renumbering or untouched anchors.
function RoleOrderDiff({ before, after, movers }: { before: RoleTier[]; after: RoleTier[]; movers: Set<string> }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
      gap: "8px", alignItems: "start", marginTop: "2px",
    }}>
      <RoleOrderColumn heading="Before" tiers={before} movers={movers} moverVariant="declined" />
      <RoleOrderColumn heading="After" tiers={after} movers={movers} moverVariant="confirmed" />
    </div>
  );
}

/** One role as snapshotted in a bulk-reorder log entry. */
type RoleSnapshot = { role_id: number; label: string; rank: number };

// Current shape is a full before/after snapshot of every role. Entries logged
// before that change carry only the roles whose rank moved, as a flat list of
// {old,new} — still renderable, just without unmoved anchor roles.
type BulkReorderExtra =
  | { before: RoleSnapshot[]; after: RoleSnapshot[] }
  | { role_id: number; label: string; old: number; new: number }[];

function normalizeBulkReorder(raw: BulkReorderExtra): { before: RoleSnapshot[]; after: RoleSnapshot[] } {
  if (Array.isArray(raw)) {
    return {
      before: raw.map((r) => ({ role_id: r.role_id, label: r.label, rank: r.old })),
      after: raw.map((r) => ({ role_id: r.role_id, label: r.label, rank: r.new })),
    };
  }
  return raw;
}

// Roles sharing a rank were tied with each other — grouping by rank and
// sorting groups by that rank turns the raw numbers into a pure ordering
// (who's before whom), with no rank value ever surfaced. Labels are sorted
// within a tier since a tie has no internal order; that also keeps a tier
// rendering identically on both sides.
function orderedTiers(rows: RoleSnapshot[]): RoleTier[] {
  const groups = new Map<number, string[]>();
  for (const r of rows) {
    if (!groups.has(r.rank)) groups.set(r.rank, []);
    groups.get(r.rank)!.push(r.label);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, labels]) => [...labels].sort((a, b) => a.localeCompare(b)));
}

/** Maps role_id -> its tier's position (0-based) within the rank ordering. */
function tierIndexByRole(rows: RoleSnapshot[]): Map<number, number> {
  const ranks = [...new Set(rows.map((r) => r.rank))].sort((a, b) => a - b);
  const positions = new Map(ranks.map((rank, i) => [rank, i]));
  return new Map(rows.map((r) => [r.role_id, positions.get(r.rank)!]));
}

// Which roles did the user actually drag? Rank deltas alone can't tell: a
// reorder renumbers bystanders for spacing, and a mover can land in a tier
// whose rank never changed (joining an untouched role's tie group).
//
// The real signal is pairwise: for any two roles that DIDN'T move, their
// relative order — and whether they're tied — must be identical before and
// after. A pair that disagrees is a "conflict", and at least one of the two
// must be a mover. So the movers are a minimal set of roles whose removal
// clears every conflict — a minimum vertex cover of the conflict graph.
//
// Exact min-cover is NP-hard; the standard greedy (repeatedly remove the
// highest-conflict role) is used instead, which is exact on the small,
// sparse graphs a real reorder produces. Only rank-changed roles are
// eligible: two rank-unchanged roles compare identically on both sides and
// so can never conflict, meaning this restriction can never strand an
// uncoverable conflict.
function findMovers(before: RoleSnapshot[], after: RoleSnapshot[]): Set<number> {
  const beforeTier = tierIndexByRole(before);
  const afterTier = tierIndexByRole(after);
  const beforeRank = new Map(before.map((r) => [r.role_id, r.rank]));
  const afterRank = new Map(after.map((r) => [r.role_id, r.rank]));
  // Roles created/deleted between the two sides have nothing to compare against.
  const ids = after.map((r) => r.role_id).filter((id) => beforeTier.has(id));

  const order = (m: Map<number, number>, x: number, y: number) => Math.sign(m.get(x)! - m.get(y)!);
  const conflicts = new Map<number, Set<number>>(ids.map((id) => [id, new Set<number>()]));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [x, y] = [ids[i], ids[j]];
      if (order(beforeTier, x, y) !== order(afterTier, x, y)) {
        conflicts.get(x)!.add(y);
        conflicts.get(y)!.add(x);
      }
    }
  }

  const movers = new Set<number>();
  const openDegree = (id: number) =>
    [...conflicts.get(id)!].filter((other) => !movers.has(other)).length;
  // Tie-break on tier displacement: between two equally-conflicted roles, the
  // one that travelled further is the likelier drag target (the other is
  // usually just riding the uniform renumber shift).
  const displacement = (id: number) => Math.abs(afterTier.get(id)! - beforeTier.get(id)!);

  for (;;) {
    const eligible = ids.filter(
      (id) => !movers.has(id) && beforeRank.get(id) !== afterRank.get(id) && openDegree(id) > 0,
    );
    if (eligible.length === 0) break;
    eligible.sort(
      (a, b) => openDegree(b) - openDegree(a) || displacement(b) - displacement(a) || a - b,
    );
    movers.add(eligible[0]);
  }
  return movers;
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
    if (e.bulk_reorder) {
      const snapshot = normalizeBulkReorder(e.bulk_reorder as BulkReorderExtra);

      // One save can bundle several independent drags, so this is a set, not
      // a single role. Empty means the reorder was pure renumbering with no
      // identifiable individual mover — render it neutral rather than guess.
      const moverIds = findMovers(snapshot.before, snapshot.after);
      const moved = snapshot.after.filter((r) => moverIds.has(r.role_id));
      const movers = new Set(moved.map((r) => r.label));

      return {
        summary: moved.length > 0
          ? (
            <>
              Moved {moved.map((r, i) => (
                <span key={r.role_id}>{i > 0 ? ", " : ""}<RoleBadge label={r.label} /></span>
              ))}
            </>
          )
          : "Reordered roles",
        details: [
          <RoleOrderDiff before={orderedTiers(snapshot.before)} after={orderedTiers(snapshot.after)} movers={movers} />,
        ],
      };
    }
    const changes = (e.changes as { field: string; old?: unknown; new?: unknown; added?: string[]; removed?: string[] }[]) ?? [];
    // entry.role is a LIVE server-side lookup by target_id, so it's null once
    // the role has been deleted. The rename recorded in `changes` still names
    // it, and is what the role was called after this very entry — a better
    // fallback than dropping the name entirely.
    const renamedTo = changes.find((c) => c.field === "label")?.new as string | undefined;
    const shownLabel = entry.role?.label ?? renamedTo;
    return {
      summary: shownLabel
        ? <>Updated role <RoleBadge label={shownLabel} /></>
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
