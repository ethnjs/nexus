'use client'

import { useEffect, useState } from 'react'
import {
  tournamentsApi, universitiesApi, Tournament, University,
  TournamentLevel, TournamentState, TournamentDivision,
  TOURNAMENT_LEVELS, TOURNAMENT_STATES, TOURNAMENT_DIVISIONS,
} from '@/lib/api'
import {
  EMPTY_TRACK_DRAFT, TrackDraft, trackDraftPayload, validateTrackDraft,
} from '@/lib/trackDraft'
import { todayLocalDateString } from '@/lib/date'
import { TbdCheckbox, TrackFields, TrackSummary } from '@/components/tournament/TrackFields'
import { TBD } from '@/lib/tournamentDisplay'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Combobox } from '@/components/ui/Combobox'
import { Checkbox } from '@/components/ui/Checkbox'
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash } from '@/components/ui/Icons'

interface NewTournamentModalProps {
  onClose: () => void
  onCreated: (t: Tournament) => void
}

interface LevelOption { value: TournamentLevel; label: string }
const LEVEL_OPTIONS: LevelOption[] = TOURNAMENT_LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))
const STATE_OPTIONS: TournamentState[] = [...TOURNAMENT_STATES]

// One track being drafted in advanced mode. Keyed rather than indexed so a
// removal doesn't shuffle React's identity for the rows below it.
interface TrackRow { key: number; draft: TrackDraft }

// The submit button lives in the modal's pinned footer, outside the <form>,
// so it has to name the form it submits.
const FORM_ID = 'new-tournament-form'

const STEP_LABELS = ['Details', 'Date and location'] as const

/** Which of the two steps you're on. Labelled, not just dotted — "step 2 of
 *  2" says nothing about what's left to fill in. */
function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as 1 | 2
        const active = n === step
        const done = n < step
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '18px', height: '18px', borderRadius: '50%',
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              background: active || done ? 'var(--color-text-primary)' : 'transparent',
              color: active || done ? 'var(--color-surface)' : 'var(--color-text-tertiary)',
              border: active || done ? 'none' : '1px solid var(--color-border-strong)',
            }}>
              {n}
            </span>
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: '12px',
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              fontWeight: active ? 600 : 400,
            }}>
              {label}
            </span>
            {n === 1 && <span style={{ width: '16px', height: '1px', background: 'var(--color-border-strong)' }} />}
          </div>
        )
      })}
    </div>
  )
}

export function NewTournamentModal({ onClose, onCreated }: NewTournamentModalProps) {
  const [name, setName]           = useState('')
  const [shortName, setShortName] = useState('')
  const [universities, setUniversities] = useState<University[]>([])
  const [locationText, setLocationText] = useState('')
  const [matchedUniversity, setMatchedUniversity] = useState<University | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [stateText, setStateText] = useState('')
  const [matchedState, setMatchedState] = useState<TournamentState | null>(null)
  const [levelText, setLevelText] = useState('')
  const [matchedLevel, setMatchedLevel] = useState<LevelOption | null>(null)
  const [division, setDivision]   = useState<TournamentDivision[]>([])
  // Most tournaments run one day, so the end date only appears when the TD
  // says it spans more — same treatment a track's dates get in TrackFields.
  const [spansDays, setSpansDays]  = useState(false)
  // Simple mode's own TBD switches, mirroring the two in TrackFields. A blank
  // date or venue is still an error; TBD is the way to say it isn't decided.
  const [datesTbd, setDatesTbd]       = useState(false)
  const [locationTbd, setLocationTbd] = useState(false)
  const [loading, setLoading]     = useState(false)
  // Only the API failure is *stored*. Field errors are derived from the
  // inputs on every render (see below), so they can never describe a value
  // that has since changed — which is what made them survive into a step the
  // TD had not filled in yet.
  const [formError, setFormError] = useState<string | null>(null)
  // Which steps have had their button pressed. Nothing is shown against a
  // step until its own action has been attempted, so arriving somewhere new
  // is always clean no matter what the inputs currently say.
  const [attempted, setAttempted] = useState({ details: false, schedule: false })
  // Two steps rather than one long form: identity first, then when/where.
  // The split is by what a TD knows at once — the name and level are decided
  // long before the venue is booked.
  const [step, setStep] = useState<1 | 2>(1)

  // Advanced mode swaps the single venue/dates/divisions for a repeatable
  // track editor. Simple mode is not a lesser thing — it creates exactly the
  // same shape, one primary track named after the tournament.
  const [advanced, setAdvanced] = useState(false)
  const [trackRows, setTrackRows] = useState<TrackRow[]>([])
  const [expandedKey, setExpandedKey] = useState<number | null>(null)

  useEffect(() => {
    universitiesApi.list().then(setUniversities).catch(() => {})
  }, [])

  // What simple mode names its one track: the short name where the TD set
  // one, the same preference tournamentDisplayName uses for the header.
  function trackName() {
    return shortName.trim() || name.trim()
  }

  function toggleDivision(d: TournamentDivision) {
    setDivision((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])
  }

  // Carries whatever has been typed into the first track, so switching modes
  // isn't a re-entry. The name defaults to the tournament's, which is exactly
  // what simple mode would have created.
  function enableAdvanced() {
    const key = Date.now()
    setExpandedKey(key)
    setTrackRows([{
      key,
      draft: {
        ...EMPTY_TRACK_DRAFT,
        name: trackName() || 'Day 1',
        is_primary: true,
        start_date: startDate,
        end_date: endDate,
        location: locationText,
        university_id: matchedUniversity?.id ?? null,
        division,
        dates_tbd: datesTbd,
        location_tbd: locationTbd,
      },
    }])
    setAttempted((a) => ({ ...a, schedule: false }))
    setAdvanced(true)
  }

  // The way back. The first competition day becomes the single site again —
  // any further tracks are dropped, which is the whole point of going back,
  // so the button says so rather than doing it silently.
  function disableAdvanced() {
    const primary = trackRows.find((row) => row.draft.is_primary)?.draft
    if (primary) {
      setLocationText(primary.location)
      setMatchedUniversity(universities.find((u) => u.id === primary.university_id) ?? null)
      setStartDate(primary.start_date)
      setEndDate(primary.end_date)
      setSpansDays(!!primary.end_date && primary.end_date !== primary.start_date)
      setDivision(primary.division)
      setDatesTbd(primary.dates_tbd)
      setLocationTbd(primary.location_tbd)
    }
    setTrackRows([])
    setAttempted((a) => ({ ...a, schedule: false }))
    setAdvanced(false)
  }

  function addTrackRow() {
    const key = Date.now()
    setTrackRows((rows) => [...rows, { key, draft: EMPTY_TRACK_DRAFT }])
    setExpandedKey(key)
  }

  function updateTrackRow(key: number, updates: Partial<TrackDraft>) {
    setTrackRows((rows) => rows.map((row) => row.key === key ? { ...row, draft: { ...row.draft, ...updates } } : row))
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
    const fieldErrors: Record<string, string> = {}
    if (!name.trim()) fieldErrors.name = 'Name is required'
    else if (/\d/.test(name)) fieldErrors.name = 'Name must not contain numbers — the year is added automatically'
    if (!matchedState) fieldErrors.state = 'State is required — pick one from the list'
    if (!matchedLevel) fieldErrors.level = 'Level is required — pick one from the list'
    return fieldErrors
  }

  /**
   * Step 2 — when and where. Two shapes behind one result: simple mode owns
   * the fields directly, advanced mode defers to each track's own validator,
   * so `rows` is keyed by track and `fields` by field name.
   */
  function validateSchedule(): { fields: Record<string, string>; rows: Record<number, Record<string, string>> } {
    const fields: Record<string, string> = {}
    const rows: Record<number, Record<string, string>> = {}

    if (!advanced) {
      if (!locationTbd && !matchedUniversity && !locationText.trim()) {
        fields.location = 'Required, or mark the venue TBD'
      }
      if (!datesTbd) {
        if (!startDate) fields.startDate = 'Required, or mark the date TBD'
        // YYYY-MM-DD strings compare lexicographically in chronological order
        else if (startDate < todayLocalDateString()) fields.startDate = 'Start date cannot be in the past'
        if (!endDate) fields.endDate = 'End date is required'
        else if (startDate && endDate < startDate) fields.endDate = 'End date cannot be before start date'
      }
      if (division.length === 0) fields.division = 'Select at least one division'
      return { fields, rows }
    }

    for (const row of trackRows) {
      const others = trackRows.filter((other) => other.key !== row.key).map((other) => other.draft.name)
      const rowErrors = validateTrackDraft(row.draft, others)
      if (Object.keys(rowErrors).length > 0) rows[row.key] = rowErrors
    }
    if (!trackRows.some((row) => row.draft.is_primary)) {
      fields.tracks = 'At least one track has to be a competition day.'
    }
    return { fields, rows }
  }

  /** The tracks to send. Assumes validateSchedule has already passed. */
  function buildTracks(): TrackDraft[] {
    if (advanced) return trackRows.map((row) => row.draft)
    // The tournament's whole schedule, as the one competition day it is.
    return [{
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
    }]
  }

  /** Next judges step 1 and nothing else. Step 2 stays un-attempted, so it
   *  renders clean however empty its fields are. */
  function goToSchedule() {
    setAttempted((a) => ({ ...a, details: true }))
    if (Object.keys(detailErrors).length === 0) setStep(2)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Enter inside a field submits the form, including the Enter that picks
    // an option out of a combobox. On step 1 that means Next, not Create.
    if (step === 1) { goToSchedule(); return }

    setAttempted({ details: true, schedule: true })

    // A step-1 problem is invisible from step 2, so go back to it rather than
    // reporting against fields the TD cannot see.
    if (Object.keys(detailErrors).length > 0) { setStep(1); return }
    if (Object.keys(scheduleErrors.fields).length > 0) return
    if (Object.keys(scheduleErrors.rows).length > 0) return
    if (!matchedState || !matchedLevel) return

    const tracks = buildTracks()

    setLoading(true)
    try {
      const t = await tournamentsApi.create({
        name: name.trim(),
        short_name: shortName.trim() || null,
        state: matchedState,
        level: matchedLevel.value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        tracks: tracks.map(trackDraftPayload),
      })
      onCreated(t)
    } catch {
      setFormError('Failed to create tournament')
    } finally {
      setLoading(false)
    }
  }

  // Recomputed every render, so an error disappears the moment the input it
  // describes becomes valid — no clearing on change, nothing to go stale.
  const detailErrors = validateDetails()
  const scheduleErrors = validateSchedule()
  // What is actually rendered: gated on that step having been attempted, so
  // a step you have only just arrived at shows nothing.
  const shownDetails = attempted.details ? detailErrors : {} as Record<string, string>
  const shownSchedule = attempted.schedule ? scheduleErrors.fields : {} as Record<string, string>
  const trackErrors = attempted.schedule ? scheduleErrors.rows : {}


  return (
    // Steps replaced the old two-column advanced layout: the track editor now
    // gets a step of its own, so it no longer has to share a row with the
    // details and can use the full width.
    <Modal
      title="New Tournament"
      onClose={onClose}
      closeOnOverlayClick={false}
      width={step === 2 && advanced ? 820 : 440}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {formError && (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)', margin: 0 }}>
              {formError}
            </p>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button
              type="button" variant="secondary" size="md" fullWidth
              onClick={step === 1 ? onClose : () => setStep(1)}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            {/* Distinct keys so Create is a new element, not Next with its type
                flipped mid-click — otherwise the click that sets step 2 lands
                on a submit button and fires Create, flagging step 2's errors. */}
            {step === 1 ? (
              <Button key="next" type="button" variant="primary" size="md" fullWidth onClick={goToSchedule}>
                Next
              </Button>
            ) : (
              // Outside the <form>, so it submits by id rather than by nesting.
              <Button key="create" type="submit" form={FORM_ID} variant="primary" size="md" fullWidth loading={loading}>
                Create
              </Button>
            )}
          </div>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <StepDots step={step} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
        {step === 1 && (<>
        <Input
          label="Name"
          required
          charset="alpha"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={shownDetails.name}
          placeholder="e.g. Caltech Invitational"
          fullWidth
          autoFocus
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
          onChange={(text, matched) => { setStateText(text); setMatchedState(matched) }}
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
          onChange={(text, matched) => { setLevelText(text); setMatchedLevel(matched) }}
          error={shownDetails.level}
          placeholder="e.g. Invitational"
        />
        </>)}

        {step === 2 && !advanced && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Combobox
                label="Location"
                required
                options={universities}
                getId={(u) => u.id}
                getLabel={(u) => u.name}
                getSearchText={(u) => `${u.name} ${u.abbreviation ?? ''}`}
                value={locationTbd ? TBD : locationText}
                onChange={(text, matched) => { setLocationText(text); setMatchedUniversity(matched) }}
                error={shownSchedule.location}
                placeholder="e.g. Caltech, Pasadena CA"
                locked={locationTbd}
              />
              <TbdCheckbox
                label="Venue not decided yet"
                checked={locationTbd}
                locked={false}
                onChange={(checked) => {
                  setLocationTbd(checked)
                  if (checked) { setLocationText(''); setMatchedUniversity(null) }
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: spansDays && !datesTbd ? '1fr 1fr' : '1fr', gap: '12px' }}>
                <Input
                  label={spansDays && !datesTbd ? 'Start Date' : 'Date'}
                  required
                  // Locked and reading "TBD" rather than removed — the field
                  // stays put, and a date input can only hold a date, so the
                  // type swaps to text to show the word.
                  type={datesTbd ? 'text' : 'date'}
                  value={datesTbd ? TBD : startDate}
                  locked={datesTbd}
                  // A single-day tournament keeps its end date in step: the
                  // track it creates needs both, and the TD has said it
                  // doesn't span days.
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    if (!spansDays) setEndDate(e.target.value)
                  }}
                  error={shownSchedule.startDate}
                  min={todayLocalDateString()}
                  fullWidth
                />
                {spansDays && !datesTbd && (
                  <Input
                    label="End Date"
                    required
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    error={shownSchedule.endDate}
                    min={startDate || todayLocalDateString()}
                    fullWidth
                  />
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: datesTbd ? 'default' : 'pointer' }}>
                <Checkbox
                  checked={spansDays && !datesTbd}
                  locked={datesTbd}
                  onChange={(checked) => {
                    setSpansDays(checked)
                    if (!checked) setEndDate(startDate)
                  }}
                />
                <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  Runs more than one day
                </span>
              </label>
              <TbdCheckbox
                label="Date not decided yet"
                checked={datesTbd}
                locked={false}
                onChange={(checked) => {
                  setDatesTbd(checked)
                  if (checked) { setSpansDays(false); setStartDate(''); setEndDate('') }
                }}
              />
            </div>
          </>
        )}


        {step === 2 && !advanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{
              fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
            }}>
              Division<span style={{ color: 'var(--color-danger)' }}> *</span>
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {TOURNAMENT_DIVISIONS.map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant={division.includes(d) ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => toggleDivision(d)}
                >
                  {d}
                </Button>
              ))}
            </div>
            {shownSchedule.division && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-danger)' }}>
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
              alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)',
              textDecoration: 'underline', textUnderlineOffset: '2px',
            }}
          >
            Runs at more than one site, or has undated tracks?
          </button>
        )}
        </div>

        {step === 2 && advanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
            <div>
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
              }}>
                Tracks<span style={{ color: 'var(--color-danger)' }}> *</span>
              </div>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                Add a track for each competition day, plus the prep leading up to it like test writing.
                Keeping them here instead of in separate tournaments means everyone stays one member
                with one set of data. Competition days set the tournament&rsquo;s dates, venue and
                divisions.{' '}
                <button
                  type="button"
                  onClick={disableAdvanced}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    font: 'inherit', color: 'var(--color-text-tertiary)',
                    textDecoration: 'underline', textUnderlineOffset: '2px',
                  }}
                >
                  Back to a single site
                </button>
                {trackRows.length > 1 && ' — keeps the first competition day only.'}
              </p>
            </div>

            <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
              {trackRows.map((row, i) => {
                const expanded = expandedKey === row.key
                const invalid = !!trackErrors[row.key]
                return (
                  <div key={row.key} style={{ borderBottom: i === trackRows.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px' }}>
                      <button
                        type="button"
                        onClick={() => setExpandedKey((cur) => (cur === row.key ? null : row.key))}
                        aria-label={expanded ? 'Collapse track' : 'Edit track'}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                      >
                        {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        <span style={{
                          fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 500,
                          color: invalid ? 'var(--color-danger)' : 'var(--color-text-primary)',
                        }}>
                          {row.draft.name.trim() || 'Untitled track'}
                        </span>
                        <TrackSummary draft={row.draft} />
                      </button>
                      {trackRows.length > 1 && (
                        <Button
                          type="button" variant="secondary" size="sm" iconOnly
                          title="Remove track"
                          aria-label={`Remove ${row.draft.name.trim() || 'track'}`}
                          onClick={() => setTrackRows((rows) => rows.filter((other) => other.key !== row.key))}
                          style={{ width: '28px', height: '28px', padding: 0, color: 'var(--color-danger)', flexShrink: 0 }}
                        >
                          <IconTrash size={14} />
                        </Button>
                      )}
                    </div>
                    {expanded && (
                      <div style={{ padding: '4px 12px 16px 34px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <Input
                          label="Name"
                          required
                          font="sans"
                          fullWidth
                          placeholder="e.g. Day 1 or Test Writing"
                          value={row.draft.name}
                          onChange={(e) => updateTrackRow(row.key, { name: e.target.value })}
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
                )
              })}
            </div>

            {shownSchedule.tracks && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-danger)', margin: 0 }}>
                {shownSchedule.tracks}
              </p>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={addTrackRow} style={{ alignSelf: 'flex-start' }}>
              <IconPlus size={14} /> Add track
            </Button>
          </div>
        )}
        </div>

      </form>
    </Modal>
  )
}
