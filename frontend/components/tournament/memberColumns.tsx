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
  name: "minmax(96px, 1.2fr)",
  email: "minmax(110px, 1.6fr)",
  // Fixed, and sized to the widest formatted number — "(555) 123-4567" is
  // ~101px at 12px mono. This is the one column that must never shrink: it
  // has no useful truncation, and squeezing it is what made it wrap.
  phone: "118px",
  duration: "74px",
  method: "100px",
  age: "124px",
  shirtSize: "64px",
  track: "104px",
  availabilityDay: "92px",
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
const TEXT_CELL: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--color-text-secondary)",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
};

const CENTERED_TEXT_CELL: CSSProperties = { ...TEXT_CELL, textAlign: "center", display: "block" };

export interface MemberColumn {
  key: string;
  label: string;
  /** Grid track for this column, from the WIDTHS table above. */
  width: string;
  align?: "center";
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

function Dash({ centered }: { centered?: boolean }) {
  return <span style={centered ? CENTERED_TEXT_CELL : TEXT_CELL}>—</span>;
}

// The columns that exist for every tournament, whatever data it holds.
function fixedColumn(key: string, collectIsOver18: boolean, collectIsOver21: boolean): MemberColumn | null {
  switch (key) {
    case "email":
      return {
        key, label: "Email", width: WIDTHS.email,
        render: (m) => <span style={TEXT_CELL} title={m.user.email}>{m.user.email}</span>,
      };
    case "phone":
      return {
        key, label: "Phone", width: WIDTHS.phone,
        render: (m) => <span style={TEXT_CELL}>{m.user.phone ? formatPhone(m.user.phone) : "—"}</span>,
      };
    case "account_age":
      return {
        key, label: "Account Age", width: WIDTHS.duration, align: "center",
        render: (m) => <DurationCell iso={m.user.created_at} />,
      };
    case "joined":
      return {
        key, label: "Joined", width: WIDTHS.duration, align: "center",
        render: (m) => <DurationCell iso={m.created_at} />,
      };
    case "method":
      return {
        key, label: "Method", width: WIDTHS.method, align: "center",
        render: (m) => <JoinMethodCell membership={m} style={{ justifySelf: "center" }} />,
      };
    case "age":
      return {
        key, label: "Age", width: WIDTHS.age, align: "center",
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
        key, label: "Shirt", width: WIDTHS.shirtSize, align: "center",
        render: (m) => <span style={CENTERED_TEXT_CELL}>{m.shirt_size ?? "—"}</span>,
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
      key, label, width: WIDTHS.track, align: "center",
      render: (m) => {
        const status = m.track_statuses.find((t) => t.track_id === trackId);
        if (!status) return <Dash centered />;
        return <Badge variant={status.status === "pending" ? "pending" : status.status}>{status.status}</Badge>;
      },
    };
  }
  if (key.startsWith(AVAILABILITY_DAY_PREFIX)) {
    const day = key.slice(AVAILABILITY_DAY_PREFIX.length);
    return {
      key, label, width: WIDTHS.availabilityDay, align: "center",
      render: (m) => (
        m.availability_days?.includes(day) ? <Badge variant="confirmed">Yes</Badge> : <Dash centered />
      ),
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
