"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MembershipAvailability, MembershipEventPreference, MembershipField, MembershipLunch,
  MembershipMe, MembershipTrackStatus, membersApi,
} from "@/lib/api";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { formatTime } from "@/lib/timeFormat";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PanelField, FieldValue, FieldList } from "@/components/profile/PanelField";
import { LunchCategoryRows } from "@/components/tournament/sections/LunchSection";

// Its own getMe rather than widening useMyMembership's: that provider loads
// on every page, and only this card needs availability and lunch.
const FIELDS: MembershipField[] = ["tracks", "availability", "lunch", "event_prefs"];

// A ranked list can run 20+ deep — the member page has the rest.
const TOP_EVENTS = 3;

/** One card per live track: what the member answered for it, and a way to change it. */
export function MySignupCards({ tournamentId }: { tournamentId: number }) {
  const router = useRouter();
  const { isArchived, archivedReason } = useArchiveLock();
  const [me, setMe] = useState<MembershipMe | null>(null);

  useEffect(() => {
    membersApi.getMe(tournamentId, FIELDS).then(setMe).catch(() => setMe(null));
  }, [tournamentId]);

  // No row (e.g. a site admin who never joined) — nothing of theirs to show.
  if (!me || me.id === null) return null;

  const memberPath = `/dashboard/tournaments/${tournamentId}/members/${me.id}`;
  // Archived here means pending deletion, taking this data with it — not
  // something to surface on a volunteer's dashboard.
  const tracks = (me.track_statuses ?? []).filter((track) => !track.is_archived);

  return (
    <>
      {tracks.map((track) => (
        <TrackSignupCard
          key={track.track_id}
          track={track}
          availability={(me.availability ?? []).filter((a) => a.track_id === track.track_id)}
          lunch={(me.lunch ?? []).filter((l) => l.track_id === track.track_id)}
          eventPreference={me.event_preferences?.find((p) => p.track_id === track.track_id) ?? null}
          onView={() => router.push(memberPath)}
          onEdit={() => router.push(`${memberPath}/edit`)}
          editLocked={isArchived}
          editTitle={archivedReason}
        />
      ))}
    </>
  );
}

function TrackSignupCard({
  track, availability, lunch, eventPreference, onView, onEdit, editLocked, editTitle,
}: {
  track: MembershipTrackStatus;
  availability: MembershipAvailability[];
  lunch: MembershipLunch[];
  eventPreference: MembershipEventPreference | null;
  onView: () => void;
  onEdit: () => void;
  editLocked: boolean;
  editTitle?: string;
}) {
  const pending = track.status === "pending";
  // Details don't matter once they've said no, and don't exist before they answer.
  const summary = pending
    ? "You haven't answered for this track yet."
    : track.status === "declined"
      ? "You're not volunteering for this track."
      : null;
  const slots = [...availability].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <Card
      radius="lg"
      style={{ width: "min(100%, 360px)", padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <span style={{
          minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600,
        }}>
          {track.name}
        </span>
        <Badge variant={track.status}>{track.status}</Badge>
      </div>

      {summary ? (
        <FieldValue muted>{summary}</FieldValue>
      ) : (
        <>
          <PanelField label="Availability">
            {slots.length === 0 ? (
              <FieldValue muted>No info yet</FieldValue>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {slots.map((slot) => (
                  <Badge key={slot.shift_id} title={`${formatTime(slot.start)}–${formatTime(slot.end)}`}>
                    {slot.label}
                  </Badge>
                ))}
              </div>
            )}
          </PanelField>
          <PanelField label="Lunch">
            {lunch.length === 0
              ? <FieldValue muted>No info yet</FieldValue>
              : <LunchCategoryRows selections={lunch} />}
          </PanelField>
          <PanelField label="Event Preferences">
            <EventPreferenceSummary pref={eventPreference} />
          </PanelField>
        </>
      )}

      {/* marginTop auto pins the actions to the bottom when a row of cards
          stretches to its tallest one. */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "auto" }}>
        <Button type="button" variant="ghost" size="sm" onClick={onView}>View all</Button>
        <Button
          type="button"
          variant={pending ? "primary" : "secondary"}
          size="sm"
          onClick={onEdit}
          disabled={editLocked}
          title={editTitle}
        >
          {pending ? "Answer" : "Edit"}
        </Button>
      </div>
    </Card>
  );
}

function EventPreferenceSummary({ pref }: { pref: MembershipEventPreference | null }) {
  if (!pref || pref.options.length === 0) return <FieldValue muted>No info yet</FieldValue>;

  const shown = pref.options.slice(0, TOP_EVENTS);
  const rest = pref.options.length - shown.length;

  return (
    <FieldList>
      {shown.map((option, i) => (
        <div key={option.option_id ?? `orphan-${i}`} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {option.rank !== null && (
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500 }}>{option.rank}.</span>
          )}
          {/* Same rule as the member page: a single-event option is just that event. */}
          <Badge>{option.events.length === 1 ? eventNameWithDivision(option.events[0]) : option.label}</Badge>
          {option.is_archived && <Badge variant="warning">Out of date</Badge>}
        </div>
      ))}
      {rest > 0 && <FieldValue muted>+{rest} more</FieldValue>}
    </FieldList>
  );
}
