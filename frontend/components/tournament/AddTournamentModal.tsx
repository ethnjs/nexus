"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TbdCheckbox, TrackFields, TrackSummary } from "@/components/tournament/TrackFields";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { CompoundButton } from "@/components/ui/CompoundButton";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import {
  IconChevronDown,
  IconChevronRight,
  IconInvite,
  IconPlus,
  IconTrash,
} from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  ApiError,
  joinApi,
  TOURNAMENT_DIVISIONS,
  TOURNAMENT_LEVELS,
  TOURNAMENT_STATES,
  type Tournament,
  type TournamentDivision,
  type TournamentLevel,
  type TournamentState,
  tournamentsApi,
  type University,
  universitiesApi,
} from "@/lib/api";
import { todayLocalDateString } from "@/lib/date";
import { TBD } from "@/lib/tournamentDisplay";
import {
  EMPTY_TRACK_DRAFT,
  type TrackDraft,
  trackDraftPayload,
  validateTrackDraft,
} from "@/lib/trackDraft";

interface AddTournamentModalProps {
  onClose: () => void;
  onCreated: (t: Tournament) => void;
  /** Skips the choice, for a caller that offered Create and Join on its own. */
  initialView?: Choice;
}

// Creating one, or joining one someone else runs with an invite.
type Choice = "create" | "join";
type View = "choose" | Choice;

const TITLES: Record<View, string> = {
  choose: "Add Tournament",
  create: "New Tournament",
  join: "Join a Tournament",
};

const JOIN_FORM_ID = "join-tournament-form";
const EXAMPLE_CODE = "Xy7kQ2mP";

/** The code in a pasted invite: a link's `?code=`, from whatever host it was
 *  copied off, or the text itself when it's a bare code. */
function inviteCode(text: string): string {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const code = url.searchParams.get("code");
    if (code) return code.trim();
  } catch {
    // Not a link — a bare code.
  }
  return trimmed;
}

interface LevelOption {
  value: TournamentLevel;
  label: string;
}
const LEVEL_OPTIONS: LevelOption[] = TOURNAMENT_LEVELS.map((l) => ({
  value: l,
  label: l[0].toUpperCase() + l.slice(1),
}));
const STATE_OPTIONS: TournamentState[] = [...TOURNAMENT_STATES];

// One track being drafted in advanced mode. Keyed rather than indexed so a
// removal doesn't shuffle React's identity for the rows below it.
interface TrackRow {
  key: number;
  draft: TrackDraft;
}

// The submit button lives in the modal's pinned footer, outside the <form>,
// so it has to name the form it submits.
const FORM_ID = "new-tournament-form";

const STEP_LABELS = ["Details", "Date and location"] as const;

/** Which of the two steps you're on. Labelled, not just dotted — "step 2 of
 *  2" says nothing about what's left to fill in. */
function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as 1 | 2;
        const active = n === step;
        const done = n < step;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                background: active || done ? "var(--color-text-primary)" : "transparent",
                color: active || done ? "var(--color-surface)" : "var(--color-text-tertiary)",
                border: active || done ? "none" : "1px solid var(--color-border-strong)",
              }}
            >
              {n}
            </span>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </span>
            {n === 1 && (
              <span
                style={{ width: "16px", height: "1px", background: "var(--color-border-strong)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AddTournamentModal({ onClose, onCreated, initialView }: AddTournamentModalProps) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialView ?? "choose");
  // What sits beside the choice in the strip, null until something is picked.
  // Kept after going back, so the view slides out rather than vanishing first.
  const [choice, setChoice] = useState<Choice | null>(initialView ?? null);
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | undefined>(undefined);
  const [joining, setJoining] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const inviteRef = useRef<HTMLInputElement>(null);

  function choose(next: Choice) {
    setChoice(next);
    setView(next);
  }

  // The body is as tall as the view showing, not the taller of the two: both
  // stay mounted side by side for the slide, so the strip alone would always
  // be the taller one's height.
  const choicePanelRef = useRef<HTMLDivElement>(null);
  const chosenPanelRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const panel = view === "choose" ? choicePanelRef.current : chosenPanelRef.current;
    if (!panel) return;
    const measure = () => setBodyHeight(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [view]);

  // preventScroll, not autoFocus: the field starts off to the side of the
  // clipped window, and focusing it plainly would scroll the window mid-slide.
  useEffect(() => {
    if (view === "join") inviteRef.current?.focus({ preventScroll: true });
    if (view === "create") nameRef.current?.focus({ preventScroll: true });
  }, [view]);

  // Checked here so a bad code is an error under the field rather than a dead
  // end; /join then shows the tournament, asks for age consent and joins.
  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = inviteCode(invite);
    if (!code) {
      setInviteError("Paste an invite link or code");
      return;
    }
    setJoining(true);
    setInviteError(undefined);
    try {
      const preview = await joinApi.preview(code);
      if (preview.type === "chapter") {
        setInviteError("That invite is for a chapter, not a tournament");
        return;
      }
      onClose();
      router.push(`/join?code=${encodeURIComponent(code)}`);
    } catch (err) {
      setInviteError(
        err instanceof ApiError && err.status === 400
          ? "That invite isn't valid or has expired"
          : "Couldn't check that invite. Try again.",
      );
    } finally {
      setJoining(false);
    }
  }

  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [universities, setUniversities] = useState<University[]>([]);
  const [locationText, setLocationText] = useState("");
  const [matchedUniversity, setMatchedUniversity] = useState<University | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [stateText, setStateText] = useState("");
  const [matchedState, setMatchedState] = useState<TournamentState | null>(null);
  const [levelText, setLevelText] = useState("");
  const [matchedLevel, setMatchedLevel] = useState<LevelOption | null>(null);
  const [division, setDivision] = useState<TournamentDivision[]>([]);
  // Simple mode's own TBD switches, mirroring the two in TrackFields. A blank
  // date or venue is still an error; TBD is the way to say it isn't decided.
  const [datesTbd, setDatesTbd] = useState(false);
  const [locationTbd, setLocationTbd] = useState(false);
  const [loading, setLoading] = useState(false);
  // Only the API failure is *stored*. Field errors are derived from the
  // inputs on every render (see below), so they can never describe a value
  // that has since changed — which is what made them survive into a step the
  // TD had not filled in yet.
  const [formError, setFormError] = useState<string | null>(null);
  // Which steps have had their button pressed. Nothing is shown against a
  // step until its own action has been attempted, so arriving somewhere new
  // is always clean no matter what the inputs currently say.
  const [attempted, setAttempted] = useState({ details: false, schedule: false });
  // Two steps rather than one long form: identity first, then when/where.
  // The split is by what a TD knows at once — the name and level are decided
  // long before the venue is booked.
  const [step, setStep] = useState<1 | 2>(1);

  // Advanced mode swaps the single venue/dates/divisions for a repeatable
  // track editor. Simple mode is not a lesser thing — it creates exactly the
  // same shape, one primary track named after the tournament.
  const [advanced, setAdvanced] = useState(false);
  const [trackRows, setTrackRows] = useState<TrackRow[]>([]);
  const [expandedKey, setExpandedKey] = useState<number | null>(null);

  useEffect(() => {
    universitiesApi
      .list()
      .then(setUniversities)
      .catch(() => {});
  }, []);

  // What simple mode names its one track: the short name where the TD set
  // one, the same preference tournamentDisplayName uses for the header.
  function trackName() {
    return shortName.trim() || name.trim();
  }

  function toggleDivision(d: TournamentDivision) {
    setDivision((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }

  // Carries whatever has been typed into the first track, so switching modes
  // isn't a re-entry. The name defaults to the tournament's, which is exactly
  // what simple mode would have created.
  function enableAdvanced() {
    const key = Date.now();
    setExpandedKey(key);
    setTrackRows([
      {
        key,
        draft: {
          ...EMPTY_TRACK_DRAFT,
          name: trackName() || "Day 1",
          is_primary: true,
          start_date: startDate,
          end_date: endDate,
          location: locationText,
          university_id: matchedUniversity?.id ?? null,
          division,
          dates_tbd: datesTbd,
          location_tbd: locationTbd,
        },
      },
    ]);
    setAttempted((a) => ({ ...a, schedule: false }));
    setAdvanced(true);
  }

  // The way back. The first competition day becomes the single site again —
  // any further tracks are dropped, which is the whole point of going back,
  // so the button says so rather than doing it silently.
  function disableAdvanced() {
    const primary = trackRows.find((row) => row.draft.is_primary)?.draft;
    if (primary) {
      setLocationText(primary.location);
      setMatchedUniversity(universities.find((u) => u.id === primary.university_id) ?? null);
      setStartDate(primary.start_date);
      setEndDate(primary.end_date);
      setDivision(primary.division);
      setDatesTbd(primary.dates_tbd);
      setLocationTbd(primary.location_tbd);
    }
    setTrackRows([]);
    setAttempted((a) => ({ ...a, schedule: false }));
    setAdvanced(false);
  }

  function addTrackRow() {
    const key = Date.now();
    setTrackRows((rows) => [...rows, { key, draft: EMPTY_TRACK_DRAFT }]);
    setExpandedKey(key);
  }

  function updateTrackRow(key: number, updates: Partial<TrackDraft>) {
    setTrackRows((rows) =>
      rows.map((row) => (row.key === key ? { ...row, draft: { ...row.draft, ...updates } } : row)),
    );
  }

  /**
   * Validation is split by step, so each button only judges what is actually
   * on screen: Next checks step 1, Create checks both. Neither validator
   * touches state — they return what is wrong and the caller decides what to
   * show, which is what lets Create surface step 1's problems by sending you
   * back to step 1 rather than reporting them against fields you can't see.
   */

  /** Step 1 — the tournament's identity. */
  function validateDetails(): Record<string, string> {
    const fieldErrors: Record<string, string> = {};
    if (!name.trim()) fieldErrors.name = "Name is required";
    else if (/\d/.test(name))
      fieldErrors.name = "Name must not contain numbers — the year is added automatically";
    if (!matchedState) fieldErrors.state = "State is required — pick one from the list";
    if (!matchedLevel) fieldErrors.level = "Level is required — pick one from the list";
    return fieldErrors;
  }

  /**
   * Step 2 — when and where. Two shapes behind one result: simple mode owns
   * the fields directly, advanced mode defers to each track's own validator,
   * so `rows` is keyed by track and `fields` by field name.
   */
  function validateSchedule(): {
    fields: Record<string, string>;
    rows: Record<number, Record<string, string>>;
  } {
    const fields: Record<string, string> = {};
    const rows: Record<number, Record<string, string>> = {};

    if (!advanced) {
      if (!locationTbd && !matchedUniversity && !locationText.trim()) {
        fields.location = "Required, or mark the venue TBD";
      }
      if (!datesTbd) {
        if (!startDate) fields.startDate = "Required, or mark the date TBD";
        // YYYY-MM-DD strings compare lexicographically in chronological order
        else if (startDate < todayLocalDateString())
          fields.startDate = "Start date cannot be in the past";
        if (!endDate) fields.endDate = "End date is required";
        else if (startDate && endDate < startDate)
          fields.endDate = "End date cannot be before start date";
      }
      if (division.length === 0) fields.division = "Select at least one division";
      return { fields, rows };
    }

    for (const row of trackRows) {
      const others = trackRows
        .filter((other) => other.key !== row.key)
        .map((other) => other.draft.name);
      const rowErrors = validateTrackDraft(row.draft, others);
      if (Object.keys(rowErrors).length > 0) rows[row.key] = rowErrors;
    }
    if (!trackRows.some((row) => row.draft.is_primary)) {
      fields.tracks = "At least one track has to be a competition day.";
    }
    return { fields, rows };
  }

  /** The tracks to send. Assumes validateSchedule has already passed. */
  function buildTracks(): TrackDraft[] {
    if (advanced) return trackRows.map((row) => row.draft);
    // The tournament's whole schedule, as the one competition day it is.
    return [
      {
        ...EMPTY_TRACK_DRAFT,
        name: trackName(),
        is_primary: true,
        start_date: startDate,
        end_date: endDate,
        location: locationText,
        university_id: matchedUniversity?.id ?? null,
        division,
        dates_tbd: datesTbd,
        location_tbd: locationTbd,
      },
    ];
  }

  /** Next judges step 1 and nothing else. Step 2 stays un-attempted, so it
   *  renders clean however empty its fields are. */
  function goToSchedule() {
    setAttempted((a) => ({ ...a, details: true }));
    if (Object.keys(detailErrors).length === 0) setStep(2);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Enter inside a field submits the form, including the Enter that picks
    // an option out of a combobox. On step 1 that means Next, not Create.
    if (step === 1) {
      goToSchedule();
      return;
    }

    setAttempted({ details: true, schedule: true });

    // A step-1 problem is invisible from step 2, so go back to it rather than
    // reporting against fields the TD cannot see.
    if (Object.keys(detailErrors).length > 0) {
      setStep(1);
      return;
    }
    if (Object.keys(scheduleErrors.fields).length > 0) return;
    if (Object.keys(scheduleErrors.rows).length > 0) return;
    if (!matchedState || !matchedLevel) return;

    const tracks = buildTracks();

    setLoading(true);
    try {
      const t = await tournamentsApi.create({
        name: name.trim(),
        short_name: shortName.trim() || null,
        state: matchedState,
        level: matchedLevel.value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        tracks: tracks.map(trackDraftPayload),
      });
      onCreated(t);
    } catch {
      setFormError("Failed to create tournament");
    } finally {
      setLoading(false);
    }
  }

  // Recomputed every render, so an error disappears the moment the input it
  // describes becomes valid — no clearing on change, nothing to go stale.
  const detailErrors = validateDetails();
  const scheduleErrors = validateSchedule();
  // What is actually rendered: gated on that step having been attempted, so
  // a step you have only just arrived at shows nothing.
  const shownDetails = attempted.details ? detailErrors : ({} as Record<string, string>);
  const shownSchedule = attempted.schedule ? scheduleErrors.fields : ({} as Record<string, string>);
  const trackErrors = attempted.schedule ? scheduleErrors.rows : {};

  return (
    // Steps replaced the old two-column advanced layout: the track editor now
    // gets a step of its own, so it no longer has to share a row with the
    // details and can use the full width.
    <Modal
      title={TITLES[view]}
      onClose={onClose}
      closeOnOverlayClick={false}
      width={view === "create" && step === 2 && advanced ? 820 : 440}
      onBack={
        view === "choose"
          ? undefined
          : view === "create" && step === 2
            ? () => setStep(1)
            : () => setView("choose")
      }
      footer={
        view === "choose" ? (
          <Button type="button" variant="secondary" size="md" fullWidth onClick={onClose}>
            Cancel
          </Button>
        ) : view === "join" ? (
          <div style={{ display: "flex", gap: "10px" }}>
            <Button type="button" variant="secondary" size="md" fullWidth onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={JOIN_FORM_ID}
              variant="primary"
              size="md"
              fullWidth
              loading={joining}
            >
              Join
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {formError && (
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                  color: "var(--color-danger)",
                  margin: 0,
                }}
              >
                {formError}
              </p>
            )}
            <div style={{ display: "flex", gap: "10px" }}>
              <Button type="button" variant="secondary" size="md" fullWidth onClick={onClose}>
                Cancel
              </Button>
              {/* Distinct keys so Create is a new element, not Next with its type
                flipped mid-click — otherwise the click that sets step 2 lands
                on a submit button and fires Create, flagging step 2's errors. */}
              {step === 1 ? (
                <Button
                  key="next"
                  type="button"
                  variant="primary"
                  size="md"
                  fullWidth
                  onClick={goToSchedule}
                >
                  Next
                </Button>
              ) : (
                // Outside the <form>, so it submits by id rather than by nesting.
                <Button
                  key="create"
                  type="submit"
                  form={FORM_ID}
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={loading}
                >
                  Create
                </Button>
              )}
            </div>
          </div>
        )
      }
    >
      {/* The choice and the chosen view side by side in a clipped window; the
          strip slides one view left to swap them. Margin, not transform, as in
          the Export modal: a transform would trap the create form's Combobox
          menus, which are position: fixed. The window's negative margin and the
          views' padding give focus rings room. */}
      <div
        style={{
          overflow: "hidden",
          margin: "-4px -6px",
          height: bodyHeight,
          transition: "height 200ms ease",
        }}
      >
        <div
          className="slide-panel-track"
          style={{
            display: "flex",
            alignItems: "flex-start",
            width: "200%",
            marginLeft: view === "choose" ? 0 : "-100%",
          }}
        >
          <div
            ref={choicePanelRef}
            inert={view !== "choose"}
            style={{
              width: "50%",
              flexShrink: 0,
              padding: "4px 6px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                color: "var(--color-text-secondary)",
                margin: "0 0 4px",
              }}
            >
              Set up a tournament to run, or join one you&rsquo;ve been invited to.
            </p>
            <CompoundButton
              icon={<IconPlus size={16} />}
              description="Start a new tournament and invite volunteers."
              onClick={() => choose("create")}
            >
              Create a tournament
            </CompoundButton>
            <CompoundButton
              icon={<IconInvite size={16} />}
              description="Use an invite link or code from its organizers."
              onClick={() => choose("join")}
            >
              Join a tournament
            </CompoundButton>
          </div>

          <div
            ref={chosenPanelRef}
            inert={view === "choose"}
            style={{ width: "50%", flexShrink: 0, padding: "4px 6px", boxSizing: "border-box" }}
          >
            {choice === "create" && (
              <form
                id={FORM_ID}
                onSubmit={handleSubmit}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: "14px" }}
              >
                <StepDots step={step} />
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "start",
                    gap: "14px",
                  }}
                >
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%" }}
                  >
                    {step === 1 && (
                      <>
                        <Input
                          ref={nameRef}
                          label="Name"
                          required
                          charset="alpha"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          error={shownDetails.name}
                          placeholder="e.g. Caltech Invitational"
                          fullWidth
                        />
                        <Input
                          label="Short Name"
                          charset="alpha"
                          value={shortName}
                          onChange={(e) => setShortName(e.target.value)}
                          placeholder="e.g. SoCal, OC, LA"
                          fullWidth
                        />
                        <Combobox
                          label="State"
                          required
                          options={STATE_OPTIONS}
                          getId={(s) => s}
                          getLabel={(s) => s}
                          allowFreeText={false}
                          value={stateText}
                          onChange={(text, matched) => {
                            setStateText(text);
                            setMatchedState(matched);
                          }}
                          error={shownDetails.state}
                          placeholder="e.g. Southern California"
                        />
                        <Combobox
                          label="Level"
                          required
                          options={LEVEL_OPTIONS}
                          getId={(o) => o.value}
                          getLabel={(o) => o.label}
                          allowFreeText={false}
                          value={levelText}
                          onChange={(text, matched) => {
                            setLevelText(text);
                            setMatchedLevel(matched);
                          }}
                          error={shownDetails.level}
                          placeholder="e.g. Invitational"
                        />
                      </>
                    )}

                    {step === 2 && !advanced && (
                      <>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          <Combobox
                            label="Location"
                            required
                            options={universities}
                            getId={(u) => u.id}
                            getLabel={(u) => u.name}
                            getSearchText={(u) => `${u.name} ${u.abbreviation ?? ""}`}
                            value={locationTbd ? TBD : locationText}
                            onChange={(text, matched) => {
                              setLocationText(text);
                              setMatchedUniversity(matched);
                            }}
                            error={shownSchedule.location}
                            placeholder="e.g. Caltech, Pasadena CA"
                            locked={locationTbd}
                          />
                          <TbdCheckbox
                            label="Venue not decided yet"
                            checked={locationTbd}
                            locked={false}
                            onChange={(checked) => {
                              setLocationTbd(checked);
                              if (checked) {
                                setLocationText("");
                                setMatchedUniversity(null);
                              }
                            }}
                          />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                          {/* Locked and reading "TBD" rather than removed, so the field stays put. */}
                          <DateRangePicker
                            label="Dates"
                            required
                            fullWidth
                            from={datesTbd ? "" : startDate}
                            to={datesTbd ? "" : endDate}
                            placeholder={datesTbd ? TBD : "Pick dates"}
                            locked={datesTbd}
                            min={todayLocalDateString()}
                            onChange={(from, to) => {
                              setStartDate(from);
                              setEndDate(to);
                            }}
                            error={shownSchedule.startDate ?? shownSchedule.endDate}
                          />
                          <TbdCheckbox
                            label="Date not decided yet"
                            checked={datesTbd}
                            locked={false}
                            onChange={(checked) => {
                              setDatesTbd(checked);
                              if (checked) {
                                setStartDate("");
                                setEndDate("");
                              }
                            }}
                          />
                        </div>
                      </>
                    )}

                    {step === 2 && !advanced && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            color: "var(--color-text-tertiary)",
                          }}
                        >
                          Division<span style={{ color: "var(--color-danger)" }}> *</span>
                        </div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          {TOURNAMENT_DIVISIONS.map((d) => (
                            <Button
                              key={d}
                              type="button"
                              variant={division.includes(d) ? "primary" : "secondary"}
                              size="sm"
                              onClick={() => toggleDivision(d)}
                            >
                              {d}
                            </Button>
                          ))}
                        </div>
                        {shownSchedule.division && (
                          <p
                            style={{
                              fontFamily: "var(--font-sans)",
                              fontSize: "12px",
                              color: "var(--color-danger)",
                            }}
                          >
                            {shownSchedule.division}
                          </p>
                        )}
                      </div>
                    )}

                    {step === 2 && !advanced && (
                      <button
                        type="button"
                        onClick={enableAdvanced}
                        style={{
                          alignSelf: "flex-start",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontFamily: "var(--font-sans)",
                          fontSize: "12px",
                          color: "var(--color-text-tertiary)",
                          textDecoration: "underline",
                          textUnderlineOffset: "2px",
                        }}
                      >
                        Runs at more than one site, or has workflows (e.g. Test Writing)?
                      </button>
                    )}
                  </div>

                  {step === 2 && advanced && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        width: "100%",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: "11px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            color: "var(--color-text-tertiary)",
                          }}
                        >
                          Tracks<span style={{ color: "var(--color-danger)" }}> *</span>
                        </div>
                        <p
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: "12px",
                            color: "var(--color-text-tertiary)",
                            margin: "4px 0 0",
                            lineHeight: 1.5,
                          }}
                        >
                          Add a track for each competition day, plus the prep leading up to it like
                          test writing. Keeping them here instead of in separate tournaments means
                          everyone stays one member with one set of data. Competition days set the
                          tournament&rsquo;s dates, venue and divisions.{" "}
                          <button
                            type="button"
                            onClick={disableAdvanced}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              cursor: "pointer",
                              font: "inherit",
                              color: "var(--color-text-tertiary)",
                              textDecoration: "underline",
                              textUnderlineOffset: "2px",
                            }}
                          >
                            Back to a single site
                          </button>
                          {trackRows.length > 1 && " — keeps the first competition day only."}
                        </p>
                      </div>

                      <div
                        style={{
                          border: "1px solid var(--color-border)",
                          borderRadius: "8px",
                          overflow: "hidden",
                        }}
                      >
                        {trackRows.map((row, i) => {
                          const expanded = expandedKey === row.key;
                          const invalid = !!trackErrors[row.key];
                          return (
                            <div
                              key={row.key}
                              style={{
                                borderBottom:
                                  i === trackRows.length - 1
                                    ? "none"
                                    : "1px solid var(--color-border)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "10px",
                                  padding: "10px 12px",
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedKey((cur) => (cur === row.key ? null : row.key))
                                  }
                                  aria-label={expanded ? "Collapse track" : "Edit track"}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    flex: 1,
                                    minWidth: 0,
                                    background: "none",
                                    border: "none",
                                    padding: 0,
                                    cursor: "pointer",
                                    textAlign: "left",
                                  }}
                                >
                                  {expanded ? (
                                    <IconChevronDown size={14} />
                                  ) : (
                                    <IconChevronRight size={14} />
                                  )}
                                  <span
                                    style={{
                                      fontFamily: "var(--font-sans)",
                                      fontSize: "14px",
                                      fontWeight: 500,
                                      color: invalid
                                        ? "var(--color-danger)"
                                        : "var(--color-text-primary)",
                                    }}
                                  >
                                    {row.draft.name.trim() || "Untitled track"}
                                  </span>
                                  <TrackSummary draft={row.draft} />
                                </button>
                                {trackRows.length > 1 && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    iconOnly
                                    title="Remove track"
                                    aria-label={`Remove ${row.draft.name.trim() || "track"}`}
                                    onClick={() =>
                                      setTrackRows((rows) =>
                                        rows.filter((other) => other.key !== row.key),
                                      )
                                    }
                                    style={{
                                      width: "28px",
                                      height: "28px",
                                      padding: 0,
                                      color: "var(--color-danger)",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <IconTrash size={14} />
                                  </Button>
                                )}
                              </div>
                              {expanded && (
                                <div
                                  style={{
                                    padding: "4px 12px 16px 34px",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "14px",
                                  }}
                                >
                                  <Input
                                    label="Name"
                                    required
                                    font="sans"
                                    fullWidth
                                    placeholder="e.g. Day 1 or Test Writing"
                                    value={row.draft.name}
                                    onChange={(e) =>
                                      updateTrackRow(row.key, { name: e.target.value })
                                    }
                                    error={trackErrors[row.key]?.name}
                                  />
                                  <TrackFields
                                    draft={row.draft}
                                    errors={trackErrors[row.key] ?? {}}
                                    universities={universities}
                                    // No tournament exists yet to hold a role catalog —
                                    // the dropdown just offers "None" until one is set
                                    // up after creation, in tournament settings.
                                    roles={[]}
                                    locked={false}
                                    onChange={(updates) => updateTrackRow(row.key, updates)}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {shownSchedule.tracks && (
                        <p
                          style={{
                            fontFamily: "var(--font-sans)",
                            fontSize: "12px",
                            color: "var(--color-danger)",
                            margin: 0,
                          }}
                        >
                          {shownSchedule.tracks}
                        </p>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={addTrackRow}
                        style={{ alignSelf: "flex-start" }}
                      >
                        <IconPlus size={14} /> Add track
                      </Button>
                    </div>
                  )}
                </div>
              </form>
            )}
            {choice === "join" && (
              <form
                id={JOIN_FORM_ID}
                onSubmit={handleJoin}
                noValidate
                style={{ display: "flex", flexDirection: "column", gap: "14px" }}
              >
                <p
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "14px",
                    color: "var(--color-text-secondary)",
                    margin: 0,
                  }}
                >
                  Paste the invite a tournament sent you to join it.
                </p>
                <Input
                  ref={inviteRef}
                  label="Invite link or code"
                  required
                  value={invite}
                  onChange={(e) => {
                    setInvite(e.target.value);
                    setInviteError(undefined);
                  }}
                  error={inviteError}
                  placeholder={`${window.location.origin}/join?code=${EXAMPLE_CODE}`}
                  font="mono"
                  fullWidth
                />
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: "12px",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    Invites look like
                  </span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {[EXAMPLE_CODE, `${window.location.origin}/join?code=${EXAMPLE_CODE}`].map(
                      (example) => (
                        <span
                          key={example}
                          style={{
                            padding: "4px 8px",
                            fontFamily: "var(--font-mono)",
                            fontSize: "12px",
                            color: "var(--color-text-secondary)",
                            background: "var(--color-bg)",
                            borderRadius: "var(--radius-sm)",
                            wordBreak: "break-all",
                          }}
                        >
                          {example}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
