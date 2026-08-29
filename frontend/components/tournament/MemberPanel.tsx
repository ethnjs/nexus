"use client";

import { useEffect, useState } from "react";
import {
  ApiError, CanonicalEvent, MembershipFull, MembershipSlim, Role,
  canonicalEventsApi, membershipsApi,
} from "@/lib/api";
import { formatDate, formatTime } from "@/lib/timeFormat";
import { DockedPanel } from "@/components/layout/DockedPanel";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { ProfileHeader } from "@/components/profile/sections/ProfileHeader";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { EducationCareerSection } from "@/components/profile/sections/EducationCareerSection";
import { CompetitionExperienceSection } from "@/components/profile/sections/CompetitionExperienceSection";
import { VolunteerExperienceSection } from "@/components/profile/sections/VolunteerExperienceSection";
import { LogisticsSection } from "@/components/profile/sections/LogisticsSection";
import { RolesCell } from "@/components/tournament/RolesCell";
import { JoinMethodCell } from "@/components/tournament/JoinMethodCell";
import { PanelField } from "@/components/tournament/PanelField";
import type { MembershipCustomAnswer } from "@/lib/api";

// Exported so the caller registering this panel in the layout slot reserves
// exactly the width the panel itself renders at.
export const MEMBER_PANEL_WIDTH = 700;

// Groups flat custom-answer rows by their source form, preserving first-seen
// form order — MembershipFullResponse doesn't group these itself since a
// membership can carry answers from several forms.
function groupCustomResponsesByForm(
  answers: MembershipCustomAnswer[],
): [string, MembershipCustomAnswer[]][] {
  const byForm = new Map<string, MembershipCustomAnswer[]>();
  for (const answer of answers) {
    const group = byForm.get(answer.form_title);
    if (group) group.push(answer);
    else byForm.set(answer.form_title, [answer]);
  }
  return Array.from(byForm.entries());
}

// A custom answer's value shape depends on the field's question_type (plain
// text, a list of selected option labels, etc.) — there's no read-only
// response renderer elsewhere to reuse yet, so this just covers the common
// shapes generically rather than switching on every question_type.
function formatCustomAnswerValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface MemberPanelProps {
  tournamentId: number;
  membershipId: number;
  allRoles: Role[];
  canTouchRole: (role: Role) => boolean;
  canEditMember: (target: MembershipSlim) => boolean;
  onClose: () => void;
  /** Bubbles role changes up so the caller's list stays in sync. */
  onUpdated?: (updated: MembershipSlim) => void;
  /** Prev/next through the table's current filtered/sorted order — omit both to hide the controls (e.g. while this panel is showing one member of a multi-select). */
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

// Read-only member detail panel — reuses the same profile section
// components as /profile/[id] (header, education, experience, logistics),
// plus the tournament-specific membership info those don't cover
// (status, join method, roles). Meant to be dropped into any tournament
// page that lists members (roster, event rosters, etc.) behind an
// "expand" action.
export function MemberPanel({
  tournamentId, membershipId, allRoles, canTouchRole, canEditMember, onClose, onUpdated,
  onPrev, onNext, hasPrev, hasNext,
}: MemberPanelProps) {
  const [full, setFull] = useState<MembershipFull | null>(null);
  const [events, setEvents] = useState<CanonicalEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    membershipsApi.get(tournamentId, membershipId)
      .then(setFull)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Failed to load member."));
    canonicalEventsApi.list().then(setEvents).catch(() => {});
  }, [tournamentId, membershipId]);

  function handleRolesUpdated(updated: MembershipSlim) {
    setFull((f) => (f ? { ...f, roles: updated.roles } : f));
    onUpdated?.(updated);
  }

  return (
    <DockedPanel
      onClose={onClose}
      width={MEMBER_PANEL_WIDTH}
      onPrev={onPrev}
      onNext={onNext}
      prevDisabled={!hasPrev}
      nextDisabled={!hasNext}
    >
      <div style={{ padding: "20px 28px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {error ? (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>{error}</p>
        ) : !full ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
            <Spinner size="lg" />
          </div>
        ) : (
          <>
            <ProfileHeader user={full.user} />

            <ProfileCard>
              <h3 style={{
                fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
                color: "var(--color-text-primary)", marginBottom: "4px",
              }}>
                Membership
              </h3>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <PanelField label="Joined">
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                    {formatDate(full.created_at)}
                  </span>
                </PanelField>
                <PanelField label="Join Method">
                  <JoinMethodCell membership={full} />
                </PanelField>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                {full.track_statuses.length > 0 && (
                  <PanelField label="Tracks">
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {full.track_statuses.map((ts) => (
                        // An archived track's statuses stay readable — the
                        // catalog entry is retired, the commitment still
                        // happened — so it's dimmed rather than hidden.
                        <div
                          key={ts.track_id}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                            opacity: ts.is_archived ? 0.55 : undefined,
                          }}
                          title={ts.is_archived ? "Archived track" : undefined}
                        >
                          <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                            {ts.name}
                          </span>
                          <Badge variant={ts.status}>{ts.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </PanelField>
                )}

                <PanelField label="Roles">
                  <RolesCell
                    tournamentId={tournamentId}
                    membership={full}
                    allRoles={allRoles}
                    canTouchRole={canTouchRole}
                    locked={!canEditMember(full)}
                    onUpdated={handleRolesUpdated}
                  />
                </PanelField>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <PanelField label="Age Flags">
                  {full.is_over_18 === null && full.is_over_21 === null ? (
                    <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--color-text-tertiary)" }}>
                      Unknown
                    </span>
                  ) : (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <Badge variant={full.is_over_18 === null ? "default" : full.is_over_18 ? "confirmed" : "declined"}>
                        {full.is_over_18 === null ? "18+ Unknown" : full.is_over_18 ? "18+" : "Under 18"}
                      </Badge>
                      <Badge variant={full.is_over_21 === null ? "default" : full.is_over_21 ? "confirmed" : "declined"}>
                        {full.is_over_21 === null ? "21+ Unknown" : full.is_over_21 ? "21+" : "Under 21"}
                      </Badge>
                    </div>
                  )}
                </PanelField>
              </div>
            </ProfileCard>

            {full.availability.length > 0 && (
              <ProfileCard>
                <h3 style={{
                  fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
                  color: "var(--color-text-primary)", marginBottom: "4px",
                }}>
                  Availability
                </h3>
                <PanelField label="Shifts">
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {full.availability.map((slot) => (
                      <span
                        key={slot.shift_id}
                        style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}
                      >
                        {slot.label} — {formatDate(slot.start)}, {formatTime(slot.start)}–{formatTime(slot.end)}
                      </span>
                    ))}
                  </div>
                </PanelField>
              </ProfileCard>
            )}

            {full.lunch.length > 0 && (
              <ProfileCard>
                <h3 style={{
                  fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
                  color: "var(--color-text-primary)", marginBottom: "4px",
                }}>
                  Lunch
                </h3>
                <PanelField label="Selections">
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {full.lunch.map((sel, i) => (
                      <span
                        key={i}
                        style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}
                      >
                        {formatDate(sel.date)} — {sel.category}: {sel.label}
                      </span>
                    ))}
                  </div>
                </PanelField>
              </ProfileCard>
            )}

            {full.event_preferences.length > 0 && (
              <ProfileCard>
                <h3 style={{
                  fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
                  color: "var(--color-text-primary)", marginBottom: "4px",
                }}>
                  Event Preferences
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {full.event_preferences.map((pref) => (
                    <PanelField key={pref.key} label={pref.key.replace(/_/g, " ")}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {pref.events.map((ev) => (
                          <span
                            key={ev.id}
                            style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}
                          >
                            {ev.rank !== null ? `${ev.rank}. ` : ""}{ev.name ?? "Unknown event"}{ev.division ? ` (${ev.division})` : ""}
                          </span>
                        ))}
                      </div>
                    </PanelField>
                  ))}
                </div>
              </ProfileCard>
            )}

            {full.custom_responses.length > 0 && (
              <ProfileCard>
                <h3 style={{
                  fontFamily: "var(--font-sans)", fontSize: "15px", fontWeight: 700,
                  color: "var(--color-text-primary)", marginBottom: "4px",
                }}>
                  Custom Responses
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {groupCustomResponsesByForm(full.custom_responses).map(([formTitle, answers]) => (
                    <div key={formTitle}>
                      <div style={{
                        fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 600,
                        color: "var(--color-text-secondary)", marginBottom: "8px",
                      }}>
                        {formTitle}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                        {answers.map((a, i) => (
                          <PanelField key={i} label={a.field_label}>
                            <span style={{ fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                              {formatCustomAnswerValue(a.value)}
                            </span>
                          </PanelField>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ProfileCard>
            )}

            <ProfileCard><EducationCareerSection user={full.user} /></ProfileCard>

            {full.user.has_competition_experience !== false && (
              <ProfileCard>
                <CompetitionExperienceSection user={full.user} mode="view" events={events} />
              </ProfileCard>
            )}

            {full.user.has_volunteer_experience !== false && (
              <ProfileCard>
                <VolunteerExperienceSection user={full.user} mode="view" events={events} />
              </ProfileCard>
            )}

            <ProfileCard><LogisticsSection user={full.user} /></ProfileCard>
          </>
        )}
      </div>
    </DockedPanel>
  );
}
