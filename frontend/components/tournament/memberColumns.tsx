"use client";

import { ReactNode, CSSProperties } from "react";
import { MembershipSlim } from "@/lib/api";
import { formatPhone } from "@/lib/auth";
import { formatDateTime, formatDuration } from "@/lib/timeFormat";
import { unslug } from "@/lib/textFormat";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { JoinMethodCell } from "@/components/tournament/JoinMethodCell";
import { AgeFlagsBadges } from "@/components/tournament/sections/AgeFlagsBadges";

// Namespaces shared with the backend's display_config — a column key means
// the same thing here as it does on the panel.
export const TRACK_PREFIX = "track:";
export const AVAILABILITY_DAY_PREFIX = "availability_day:";
export const LUNCH_CATEGORY_PREFIX = "lunch_category:";
export const FORM_FIELD_PREFIX = "form_field:";

// Grid track per kind of data, not per individual column. Width is a property
// of what the cell holds — every track badge is about as wide as every other
// one — so a tournament adding a track never requires a new width decision.
//
// Fixed px wherever the content has a known maximum (a formatted phone, a
// duration like "3mo", a badge); minmax() only where content is genuinely
// open-ended. The min half of each minmax is what stops a narrow window from
// squeezing a cell until it wraps — an `fr` track alone happily shrinks to
// nothing, which is what had phone wrapping.
const WIDTHS = {
  // Floor is higher than a plain text column's: the avatar and its gap take
  // ~32px before a single character of the name is drawn.
  name: "minmax(160px, 1.1fr)",
  // Low flex on purpose: 190px already holds a typical address, so the extra
  // space of a full-width table is better spent on Roles than on padding out
  // an already-fitting email.
  email: "minmax(190px, 0.7fr)",
  // Fixed, and sized to the widest formatted number — "(555) 123-4567" is
  // ~101px at 12px mono. This is the one column that must never shrink: it
  // has no useful truncation, and squeezing it is what made it wrap.
  phone: "108px",
  duration: "74px",
  // Wider than `duration` only because "ACCOUNT AGE" is the long header; the
  // value inside is the same "3mo" the other duration columns hold.
  accountAge: "96px",
  method: "100px",
  age: "124px",
  shirtSize: "64px",
  track: "104px",
  availabilityDay: "minmax(110px, 0.7fr)",
  lunchCategory: "minmax(90px, 0.8fr)",
  customField: "minmax(100px, 1fr)",
  roles: "minmax(110px, 2.6fr)",
  // The collapsed form of `roles`, for when a docked panel narrows the table.
  // Deliberately still a minmax(<length>, <flex>): grid-template-columns only
  // interpolates track-for-track between matching value types, so a bare
  // "0px" here would make the whole template snap instead of animating.
  rolesCollapsed: "minmax(0px, 0fr)",
  actions: "70px",
} as const;

// Applied to every text cell. minWidth:0 is the load-bearing part: a grid
// item defaults to min-width:auto, so it refuses to shrink below its content
// and pushes the row wide instead of ellipsing.
const LEFT_TEXT_CELL: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
  textAlign: "left", display: "block", width: "100%",
};

const TEXT_CELL: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
  // Every configured column centers — header and cell alike — so a row reads
  // as a set of aligned marks rather than ragged text of varying length.
  textAlign: "center", display: "block", width: "100%",
};

export interface MemberColumn {
  key: string;
  label: string;
  /** Grid track for this column, from the WIDTHS table above. */
  width: string;
  /** Columns centre by default; "start" is for values read left-to-right at length, where a centred ellipsis reads badly. */
  align?: "start";
  render: (membership: MembershipSlim) => ReactNode;
}

// The coarse duration ("3mo") with the exact moment behind it on hover —
// the coarse form is what fits the column, but the precise date is what a
// coordinator actually needs when it matters.
function DurationCell({ iso }: { iso: string }) {
  return (
    <span style={{ justifySelf: "center" }}>
      <Tooltip variant="info" message={formatDateTime(iso)} showIcon={false}>
        <span style={{ ...TEXT_CELL, cursor: "default" }}>{formatDuration(iso)}</span>
      </Tooltip>
    </span>
  );
}

function Dash() {
  return <span style={TEXT_CELL}>—</span>;
}

// The columns that exist for every tournament, whatever data it holds.
function fixedColumn(key: string, collectIsOver18: boolean, collectIsOver21: boolean): MemberColumn | null {
  switch (key) {
    case "email":
      return {
        key, label: "Email", width: WIDTHS.email, align: "start",
        render: (m) => <span style={LEFT_TEXT_CELL} title={m.user.email}>{m.user.email}</span>,
      };
    case "phone":
      return {
        key, label: "Phone", width: WIDTHS.phone,
        render: (m) => <span style={TEXT_CELL}>{m.user.phone ? formatPhone(m.user.phone) : "—"}</span>,
      };
    case "account_age":
      return {
        key, label: "Account Age", width: WIDTHS.accountAge,
        render: (m) => <DurationCell iso={m.user.created_at} />,
      };
    case "joined":
      return {
        key, label: "Joined", width: WIDTHS.duration,
        render: (m) => <DurationCell iso={m.created_at} />,
      };
    case "method":
      return {
        key, label: "Method", width: WIDTHS.method,
        render: (m) => <JoinMethodCell membership={m} style={{ justifySelf: "center" }} />,
      };
    case "age":
      return {
        key, label: "Age", width: WIDTHS.age,
        render: (m) => (
          <AgeFlagsBadges
            isOver18={m.is_over_18}
            isOver21={m.is_over_21}
            collectIsOver18={collectIsOver18}
            collectIsOver21={collectIsOver21}
          />
        ),
      };
    case "shirt_size":
      return {
        key, label: "Shirt", width: WIDTHS.shirtSize,
        render: (m) => <span style={TEXT_CELL}>{m.shirt_size ?? "—"}</span>,
      };
    default:
      return null;
  }
}

// Same option-snapshot unwrapping the panel's Custom Responses does — a
// select answer is stored as {option_id, value, label}, not a bare string.
function formatAnswer(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.map(formatAnswer).join(", ") : "—";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("option_id" in record) return String(record.value ?? record.label ?? "");
    return Object.values(record).map(formatAnswer).join(", ");
  }
  return String(value);
}

// One column per entity — a track, an availability day, a lunch category, a
// custom field. The label comes from the display-config catalog, which named
// the key in the first place, so the two can't disagree.
function entityColumn(key: string, label: string): MemberColumn | null {
  if (key.startsWith(TRACK_PREFIX)) {
    const trackId = Number(key.slice(TRACK_PREFIX.length));
    return {
      key, label, width: WIDTHS.track,
      render: (m) => {
        const status = m.track_statuses.find((t) => t.track_id === trackId);
        if (!status) return <Dash />;
        return <Badge variant={status.status === "pending" ? "pending" : status.status}>{status.status}</Badge>;
      },
    };
  }
  if (key.startsWith(AVAILABILITY_DAY_PREFIX)) {
    const day = key.slice(AVAILABILITY_DAY_PREFIX.length);
    return {
      key, label, width: WIDTHS.availabilityDay,
      render: (m) => {
        // Matched on the server-resolved `day`, never on the shift's start:
        // that's an instant, and the viewer's timezone need not be the
        // tournament's, so deriving the day here could put a shift in the
        // wrong column.
        const shifts = (m.availability_shifts ?? []).filter((shift) => shift.day === day);
        if (shifts.length === 0) return <Dash />;
        return (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", minWidth: 0, justifyContent: "center" }}>
            {shifts.map((shift) => (
              <Badge key={shift.shift_id} variant="confirmed">{shift.label}</Badge>
            ))}
          </div>
        );
      },
    };
  }
  if (key.startsWith(LUNCH_CATEGORY_PREFIX)) {
    const category = key.slice(LUNCH_CATEGORY_PREFIX.length);
    return {
      key, label, width: WIDTHS.lunchCategory,
      render: (m) => {
        const picks = (m.lunch ?? []).filter((row) => row.category === category);
        if (picks.length === 0) return <Dash />;
        const text = picks.map((p) => p.value).join(", ");
        return <span style={TEXT_CELL} title={text}>{text}</span>;
      },
    };
  }
  if (key.startsWith(FORM_FIELD_PREFIX)) {
    return {
      key, label, width: WIDTHS.customField,
      render: (m) => {
        const answer = (m.custom_responses ?? []).find((a) => `${FORM_FIELD_PREFIX}${a.field_id}` === key);
        const text = answer ? formatAnswer(answer.value) : "—";
        return <span style={TEXT_CELL} title={text}>{text}</span>;
      },
    };
  }
  return null;
}

/**
 * Resolves saved column keys into renderable columns, dropping any that no
 * longer resolve — a deleted track's key outlives the track, and a stale key
 * must not blank out the whole table. `labels` comes from the display-config
 * catalog; the fallback only matters if the catalog hasn't loaded yet.
 */
export function resolveColumns(
  keys: string[],
  labels: Map<string, string>,
  collectIsOver18: boolean,
  collectIsOver21: boolean,
): MemberColumn[] {
  return keys
    .map((key) =>
      fixedColumn(key, collectIsOver18, collectIsOver21)
      ?? entityColumn(key, labels.get(key) ?? unslug(key.split(":").pop() ?? key))
    )
    .filter((column): column is MemberColumn => column !== null);
}

export const COLUMN_WIDTHS = WIDTHS;

// Narrower floors for when a docked panel is open. The panel takes roughly a
// third of the window, and the floors above can then add up to more than the
// table has left — the grid overflows and the last column (Actions) is
// clipped by the card's edge. Select mode makes it worse by another 28px.
//
// Name and email are the columns a coordinator actually reads, so they hold
// floors that stay legible (~17 and ~20 mono characters) and the other
// ellipsing text columns give instead. Phone and the badge columns are left
// alone — phone has no useful truncation, and badges wrap (ballooning the row
// height) rather than ellipse.
//
// Safe by construction: a floor only binds when space is scarce, so this is
// identical to the full-width table whenever the table actually fits.
const COMPACT_TRACKS: Record<string, string> = {
  [WIDTHS.name]: "minmax(132px, 1.4fr)",
  [WIDTHS.email]: "minmax(150px, 0.7fr)",
  // Free-text answers: shorter than name/email are worth, and they keep their
  // hover title, so these are the cheapest characters in the row to spend.
  [WIDTHS.lunchCategory]: "minmax(70px, 0.5fr)",
  [WIDTHS.customField]: "minmax(76px, 0.6fr)",
};

/** The panel-open form of a track, or the track itself if it can't give. */
export function compactTrack(width: string): string {
  return COMPACT_TRACKS[width] ?? width;
}

// Roles is the elastic column: it holds wrapping chips, so it can give space
// back as data columns are added, and it's the only track wide enough to be
// worth taking from. Shrinks per configured column past the default five,
// with a floor that still fits two chips before wrapping.
const ROLES_BASE_FR = 2.6;
const ROLES_FR_PER_COLUMN = 0.3;
const ROLES_MIN_FR = 0.8;
const ROLES_FREE_COLUMNS = 5;

export function rolesWidth(columnCount: number): string {
  const share = Math.max(
    ROLES_MIN_FR,
    ROLES_BASE_FR - Math.max(0, columnCount - ROLES_FREE_COLUMNS) * ROLES_FR_PER_COLUMN,
  );
  return `minmax(110px, ${share}fr)`;
}
