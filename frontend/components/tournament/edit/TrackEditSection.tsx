"use client";

import type { MyTrackOptions, TrackStatus } from "@/lib/api";
import { TrackDraft, allowedStatuses, optedInStatus } from "@/lib/memberEdit";
import { QuestionRenderer } from "@/components/forms/QuestionRenderer";
import { Badge } from "@/components/ui/Badge";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Card } from "@/components/ui/Card";

const STATUS_LABEL: Record<TrackStatus, string> = {
  interested: "Interested",
  confirmed: "Confirmed",
  declined: "Not taking part",
};

const NOT_AVAILABLE = "__none__";

/**
 * One track's controls: status, availability, lunch, event preferences —
 * whichever of them this track actually asks about.
 *
 * The questions render through QuestionRenderer in interactive mode, the same
 * widget a respondent answers the form with, so a member sees the TD's own
 * option labels rather than a second set of controls invented here.
 */
export function TrackEditSection({ track, draft, onChange }: {
  track: MyTrackOptions;
  draft: TrackDraft;
  onChange: (updates: Partial<TrackDraft>) => void;
}) {
  const statuses = allowedStatuses(track.allow_confirm);
  const hasQuestions = track.availability.length > 0 || track.lunch.length > 0 || !!track.event_preferences;

  return (
    <Card radius="lg" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "20px" }}>{track.track_name}</h2>
        {!track.is_primary && <Badge>No schedule</Badge>}
      </div>

      {/* Driven by the route's own rule rather than by a track_status
          question's options — those can span several tracks, and this control
          answers for exactly one. See backend/track-status-rules.md. */}
      <Field
        label="Taking part"
        helper={track.allow_confirm
          ? "Confirmations are open — confirm to lock in your spot."
          : "Confirmations aren't open yet. Say you're interested, and you'll be asked to confirm later."}
      >
        <ButtonGroup
          options={statuses.map((status) => ({ value: status, label: STATUS_LABEL[status] }))}
          value={draft.status ?? ""}
          onChange={(value) => {
            const status = value as TrackStatus;
            // Declining and clearing availability are the same act — keeping
            // shifts selected while declined would say two different things.
            onChange({ status, notAvailable: status === "declined" });
          }}
        />
      </Field>

      {track.availability.map((field) => (
        <Field key={field.id} label={field.label} helper={field.description ?? undefined}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ opacity: draft.notAvailable ? 0.45 : 1, transition: "opacity 120ms ease" }}>
              <QuestionRenderer
                field={field}
                interactive
                showHeader={false}
                value={draft.notAvailable ? (field.question_type === "multi_select_checkbox" ? [] : "") : draft.availability[field.id]}
                onChange={(value) => onChange({
                  availability: { ...draft.availability, [field.id]: value },
                  // Picking a real group is opting back in, and the save
                  // sends both in one request.
                  notAvailable: false,
                  status: draft.notAvailable ? optedInStatus(track.allow_confirm) : draft.status,
                })}
              />
            </div>
            {/* Mutually exclusive with the groups above, and not one of the
                TD's own options — a member declining is an answer the form
                doesn't have to offer for them to be able to give it. */}
            <ButtonGroup
              options={[{ value: NOT_AVAILABLE, label: "I'm not available" }]}
              value={draft.notAvailable ? NOT_AVAILABLE : ""}
              onChange={() => onChange({
                notAvailable: !draft.notAvailable,
                status: draft.notAvailable ? draft.status : "declined",
              })}
            />
          </div>
        </Field>
      ))}

      {track.lunch.map((field) => (
        <Field key={field.id} label={field.label} helper={field.description ?? undefined}>
          <QuestionRenderer
            field={field}
            interactive
            showHeader={false}
            value={draft.lunch[field.id]}
            onChange={(value) => onChange({ lunch: { ...draft.lunch, [field.id]: value } })}
          />
        </Field>
      ))}

      {track.event_preferences && (
        <Field
          label={track.event_preferences.label}
          helper={track.event_preferences.description ?? undefined}
        >
          <QuestionRenderer
            field={track.event_preferences}
            interactive
            showHeader={false}
            value={draft.eventPreference}
            onChange={(value) => onChange({ eventPreference: value })}
          />
        </Field>
      )}

      {!hasQuestions && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", margin: 0 }}>
          Nothing else to fill in for this track yet.
        </p>
      )}
    </Card>
  );
}

function Field({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
          {label}
        </div>
        {helper && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "3px" }}>
            {helper}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
