"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MembershipAvailability, MembershipEventPreference, MembershipField, MembershipLunch,
  MembershipMe, MembershipTrackStatus, TournamentShift, membersApi, tournamentShiftsApi,
} from "@/lib/api";
import { useArchiveLock } from "@/lib/useArchiveLock";
import { TRACK_LOCKED_REASON } from "@/lib/responseLock";
import { eventNameWithDivision } from "@/lib/eventDisplay";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconLock } from "@/components/ui/Icons";
import { OverviewCard } from "@/components/tournament/overview/OverviewCard";
import { PanelField, FieldValue, FieldList } from "@/components/profile/PanelField";
import { LunchCategoryRows } from "@/components/tournament/sections/LunchSection";
import { AvailabilityDays } from "@/components/tournament/sections/AvailabilitySection";

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
  // Every offered shift, so each timeline spans its whole day rather than
  // just the member's own shifts.
  const [shifts, setShifts] = useState<TournamentShift[]>([]);

  useEffect(() => {
    membersApi.getMe(tournamentId, FIELDS).then(setMe).catch(() => setMe(null));
    tournamentShiftsApi.list(tournamentId).then(setShifts).catch(() => setShifts([]));
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
          shifts={shifts.filter((shift) => shift.track_id === track.track_id)}
          lunch={(me.lunch ?? []).filter((l) => l.track_id === track.track_id)}
          eventPreference={me.event_preferences?.find((p) => p.track_id === track.track_id) ?? null}
          onView={() => router.push(memberPath)}
          onEdit={() => router.push(`${memberPath}/edit`)}
          // A locked track still shows everything the member answered — only
          // changing it is closed, and the card says who to ask.
          lockedReason={isArchived ? archivedReason : track.lock_responses ? TRACK_LOCKED_REASON : undefined}
        />
      ))}
    </>
  );
}

function TrackSignupCard({
  track, availability, shifts, lunch, eventPreference, onView, onEdit, lockedReason,
}: {
  track: MembershipTrackStatus;
  availability: MembershipAvailability[];
  shifts: TournamentShift[];
  lunch: MembershipLunch[];
  eventPreference: MembershipEventPreference | null;
  onView: () => void;
  onEdit: () => void;
  /** Set when the member can't change anything here; says why. */
  lockedReason?: string;
}) {
  const pending = track.status === "pending";
  const locked = !!lockedReason;
  // Details don't matter once they've said no, and don't exist before they
  // answer. Before then there is nothing to edit either: the first answer
  // always goes through a form, so the card says so rather than offering one.
  const summary = pending
    ? "You haven't answered for this track yet."
    : track.status === "declined"
      ? "You're not volunteering for this track."
      : null;

  return (
    <OverviewCard title={track.name} action={<Badge variant={track.status}>{track.status}</Badge>}>

      {/* Spelled out rather than left to the button's `title`: a disabled
          button fires no mouse events, so that tooltip never opens. Above any
          answers, which are still worth reading on a locked track. */}
      {lockedReason && <LockNotice reason={lockedReason} />}

      {/* Nothing answered and nothing answerable: the notice is the whole
          story, so no prompt to answer under it. */}
      {locked && pending ? null : summary ? (
        <FieldValue muted>{summary}</FieldValue>
      ) : (
        <>
          <PanelField label="Availability">
            {/* The member panel's timeline, stacked under its badges to fit the card. */}
            {availability.length === 0
              ? <FieldValue muted>No info yet</FieldValue>
              : <AvailabilityDays availability={availability} allShifts={shifts} stacked />}
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

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <Button type="button" variant="ghost" size="sm" onClick={onView}>View all</Button>
        {/* Only ever an edit: there is no answering from here (see summary). */}
        <Button type="button" variant="secondary" size="sm" onClick={onEdit} disabled={locked || pending}>
          Edit
        </Button>
      </div>
    </OverviewCard>
  );
}

/** The lock, said once at the top of the card. EmptyState's look — dashed,
 *  centred, stacked — without its fixed 240px height, which would dwarf a
 *  card that otherwise holds two lines. */
function LockNotice({ reason }: { reason: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
      padding: "16px", textAlign: "center",
      border: "1px dashed var(--color-border)", borderRadius: "var(--radius-lg)",
      background: "var(--color-surface)",
    }}>
      <span style={{ display: "flex", color: "var(--color-text-tertiary)" }}>
        <IconLock size={20} />
      </span>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", maxWidth: "300px", margin: 0 }}>
        {reason}
      </p>
    </div>
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
