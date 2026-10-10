"use client";

import { ReactNode, CSSProperties } from "react";
import { MembershipFull } from "@/lib/api";
import type { MemberSortField } from "@/lib/memberSort";
import { formatPhone } from "@/lib/auth";
import { formatDateTime, formatDuration } from "@/lib/timeFormat";
import { unslug } from "@/lib/textFormat";
import { Badge } from "@/components/ui/Badge";
import { Tooltip } from "@/components/ui/Tooltip";
import { JoinMethodCell } from "@/components/tournament/members/JoinMethodCell";
import { AgeFlagsBadges } from "@/components/tournament/members/sections/AgeFlagsBadges";
import { OnboardingProgress } from "@/components/tournament/members/OnboardingProgress";
import { PreferenceOptionLine } from "@/components/tournament/members/sections/EventPreferencesSection";
import { eventNameWithDivision } from "@/lib/eventDisplay";

import {
  AVAILABILITY_TRACK_PREFIX, EVENT_PREF_PREFIX, FORM_FIELD_PREFIX, LUNCH_PREFIX, TRACK_PREFIX,
} from "@/lib/memberColumnKeys";

// Re-exported so existing importers keep working; the definitions live in lib.
export { AVAILABILITY_TRACK_PREFIX, EVENT_PREF_PREFIX, FORM_FIELD_PREFIX, LUNCH_PREFIX, TRACK_PREFIX };

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
  // Free-text columns are never narrower than their longest value: nothing is
  // cut off, and the table scrolls sideways instead (see Table.module.css's
  // .scroll). Low flex on email, since the spare width is better spent on Roles.
  email: "minmax(max-content, 0.7fr)",
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
  // A 16px ring, a gap and "10/10" — the widest count a real sequence reaches.
  onboarding: "96px",
  track: "104px",
  availabilityDay: "minmax(110px, 0.7fr)",
  lunchCategory: "minmax(max-content, 0.8fr)",
  customField: "minmax(max-content, 1fr)",
  // Free text ("Peanut allergy, vegetarian") — open-ended, read left to right.
  dietary: "minmax(max-content, 1fr)",
  // Never narrower than its longest line: the list is shown whole, and the
  // table scrolls sideways instead of cutting a choice off (see table.scroll).
  eventPrefs: "minmax(max-content, 1fr)",
  // A floor that holds a few chips before they wrap. It no longer gives way
  // as data columns are added — those scroll sideways instead.
  roles: "minmax(240px, 2.6fr)",
  // The collapsed form of `roles`, for when a docked panel narrows the table.
  // Deliberately still a minmax(<length>, <flex>): grid-template-columns only
  // interpolates track-for-track between matching value types, so a bare
  // "0px" here would make the whole template snap instead of animating.
  rolesCollapsed: "minmax(0px, 0fr)",
  // One icon button (delete) — the header stays blank, "Actions" wouldn't fit.
  actions: "40px",
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
  render: (membership: MembershipFull) => ReactNode;
  /** Set when the header sorts by this column (see SortableHeader). */
  sortField?: MemberSortField;
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
        key, label: "Account Age", width: WIDTHS.accountAge, sortField: "account_age",
        render: (m) => <DurationCell iso={m.user.created_at} />,
      };
    case "joined":
      return {
        key, label: "Joined", width: WIDTHS.duration, sortField: "joined",
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
            compact
          />
        ),
      };
    case "shirt_size":
      return {
        key, label: "Shirt", width: WIDTHS.shirtSize,
        render: (m) => <span style={TEXT_CELL}>{m.user.shirt_size ?? "—"}</span>,
      };
    case "dietary_restriction":
      return {
        key, label: "Dietary", width: WIDTHS.dietary, align: "start",
        render: (m) => {
          const text = m.user.dietary_restriction;
          return text ? <span style={LEFT_TEXT_CELL} title={text}>{text}</span> : <Dash />;
        },
      };
    case "onboarding":
      return {
        key, label: "Onboarding", width: WIDTHS.onboarding,
        render: (m) => (
          <span style={{ display: "flex", justifyContent: "center", minWidth: 0 }}>
            <OnboardingProgress progress={m.onboarding} />
          </span>
        ),
      };
    default:
      return null;
  }
}

// Same option-snapshot unwrapping the panel's Custom Responses does — a
// select answer is stored as {option_id, value, label}, not a bare string.
export function formatAnswer(value: unknown): string {
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
// track's event preferences, a custom field. The label comes from the
// display-config catalog, which named the key in the first place, so the two
// can't disagree. Per-track kinds suffix it ("Day 1 status"), since status,
// availability and preferences would otherwise all be headed "Day 1".
// "lunch:{track_id}:{category}" — a category is a slug, so it can never
// contain a colon of its own; splitting on the first separator is safe.
function splitLunchKey(key: string): [number, string] {
  const rest = key.slice(LUNCH_PREFIX.length);
  const separator = rest.indexOf(":");
  return separator === -1
    ? [Number(rest), ""]
    : [Number(rest.slice(0, separator)), rest.slice(separator + 1)];
}

function entityColumn(key: string, label: string): MemberColumn | null {
  if (key.startsWith(TRACK_PREFIX)) {
    const trackId = Number(key.slice(TRACK_PREFIX.length));
    return {
      key, label: `${label} status`, width: WIDTHS.track, sortField: key,
      render: (m) => {
        const status = (m.track_statuses ?? []).find((t) => t.track_id === trackId);
        if (!status) return <Dash />;
        return <Badge variant={status.status === "pending" ? "pending" : status.status}>{status.status}</Badge>;
      },
    };
  }
  if (key.startsWith(AVAILABILITY_TRACK_PREFIX)) {
    const trackId = Number(key.slice(AVAILABILITY_TRACK_PREFIX.length));
    return {
      key, label: `${label} availability`, width: WIDTHS.availabilityDay, sortField: key,
      render: (m) => {
        // Keyed by track, not by day: two sites running the same Saturday are
        // separate tracks, and pooling their shifts into one column would
        // claim a member is free at both.
        const shifts = (m.availability ?? []).filter((shift) => shift.track_id === trackId);
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
  if (key.startsWith(LUNCH_PREFIX)) {
    const [trackId, category] = splitLunchKey(key);
    return {
      key, label, width: WIDTHS.lunchCategory, sortField: key,
      render: (m) => {
        // Both halves: Day 1's protein and Day 2's protein are different
        // questions, and the category alone would merge them.
        const picks = (m.lunch ?? []).filter((row) => row.track_id === trackId && row.category === category);
        if (picks.length === 0) return <Dash />;
        const text = picks.map((p) => p.value).join(", ");
        return <span style={TEXT_CELL} title={text}>{text}</span>;
      },
    };
  }
  if (key.startsWith(EVENT_PREF_PREFIX)) {
    const trackId = Number(key.slice(EVENT_PREF_PREFIX.length));
    return {
      key, label: `${label} prefs`, width: WIDTHS.eventPrefs, align: "start",
      render: (m) => {
        const answer = (m.event_preferences ?? []).find((p) => p.track_id === trackId);
        if (!answer || answer.options.length === 0) return <Dash />;
        // Rank order; an unranked pick (a checkbox question) keeps its place after the ranked ones.
        const options = [...answer.options].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
        // One choice per line, as in the panel. A grouped option can't open
        // here, so its events are on hover instead.
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "2px 0" }}>
            {options.map((option, i) => (
              <div
                key={option.option_id ?? `orphan-${i}`}
                style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}
                title={option.events.length > 1 ? option.events.map(eventNameWithDivision).join("\n") : undefined}
              >
                <PreferenceOptionLine option={option} compact />
              </div>
            ))}
          </div>
        );
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
// Only Name gives: the free-text columns are content-sized so they're never
// cut off, and a max-content floor can't animate to a px one anyway — the
// table scrolls sideways while the panel is open instead.
//
// Safe by construction: a floor only binds when space is scarce, so this is
// identical to the full-width table whenever the table actually fits.
const COMPACT_TRACKS: Record<string, string> = {
  [WIDTHS.name]: "minmax(132px, 1.4fr)",
};

/** The panel-open form of a track, or the track itself if it can't give. */
export function compactTrack(width: string): string {
  return COMPACT_TRACKS[width] ?? width;
}
