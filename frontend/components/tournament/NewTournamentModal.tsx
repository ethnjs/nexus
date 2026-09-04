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
import { TrackFields, TrackSummary } from '@/components/tournament/TrackFields'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Combobox } from '@/components/ui/Combobox'
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
  const [loading, setLoading]     = useState(false)
  const [errors, setErrors]       = useState<Record<string, string>>({})

  // Advanced mode swaps the single venue/dates/divisions for a repeatable
  // track editor. Simple mode is not a lesser thing — it creates exactly the
  // same shape, one primary track named after the tournament.
  const [advanced, setAdvanced] = useState(false)
  const [trackRows, setTrackRows] = useState<TrackRow[]>([])
  const [trackErrors, setTrackErrors] = useState<Record<number, Record<string, string>>>({})
  const [expandedKey, setExpandedKey] = useState<number | null>(null)

  useEffect(() => {
    universitiesApi.list().then(setUniversities).catch(() => {})
  }, [])

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
        name: name.trim() || 'Day 1',
        is_primary: true,
        start_date: startDate,
        end_date: endDate,
        location: locationText,
        university_id: matchedUniversity?.id ?? null,
        division,
      },
    }])
    setErrors({})
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
      setDivision(primary.division)
    }
    setTrackRows([])
    setTrackErrors({})
    setErrors({})
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

  /** The tracks to send, or null when something doesn't validate. */
  function collectTracks(): TrackDraft[] | null {
    if (!advanced) {
      const fieldErrors: Record<string, string> = {}
      if (!matchedUniversity && !locationText.trim()) fieldErrors.location = 'Location is required'
      if (!startDate) fieldErrors.startDate = 'Start date is required'
      // YYYY-MM-DD strings compare lexicographically in chronological order
      else if (startDate < todayLocalDateString()) fieldErrors.startDate = 'Start date cannot be in the past'
      if (!endDate) fieldErrors.endDate = 'End date is required'
      else if (startDate && endDate < startDate) fieldErrors.endDate = 'End date cannot be before start date'
      if (division.length === 0) fieldErrors.division = 'Select at least one division'

      if (Object.keys(fieldErrors).length > 0) { setErrors((prev) => ({ ...prev, ...fieldErrors })); return null }

      // The tournament's whole schedule, as the one competition day it is.
      return [{
        ...EMPTY_TRACK_DRAFT,
        name: name.trim(),
        is_primary: true,
        start_date: startDate,
        end_date: endDate,
        location: locationText,
        university_id: matchedUniversity?.id ?? null,
        division,
      }]
    }

    const found: Record<number, Record<string, string>> = {}
    for (const row of trackRows) {
      const others = trackRows.filter((other) => other.key !== row.key).map((other) => other.draft.name)
      const rowErrors = validateTrackDraft(row.draft, others)
      if (Object.keys(rowErrors).length > 0) found[row.key] = rowErrors
    }
    setTrackErrors(found)
    if (Object.keys(found).length > 0) return null
    if (!trackRows.some((row) => row.draft.is_primary)) {
      setErrors((prev) => ({ ...prev, tracks: 'At least one track has to be a competition day.' }))
      return null
    }
    return trackRows.map((row) => row.draft)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fieldErrors: Record<string, string> = {}

    if (!name.trim()) fieldErrors.name = 'Name is required'
    else if (/\d/.test(name)) fieldErrors.name = 'Name must not contain numbers — the year is added automatically'
    if (!matchedState) fieldErrors.state = 'State is required — pick one from the list'
    if (!matchedLevel) fieldErrors.level = 'Level is required — pick one from the list'

    setErrors(fieldErrors)
    const tracks = collectTracks()
    if (Object.keys(fieldErrors).length > 0 || !tracks || !matchedState || !matchedLevel) return

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
      setErrors({ form: 'Failed to create tournament' })
    } finally {
      setLoading(false)
    }
  }

  return (
    // Advanced widens the modal rather than lengthening it: details on the
    // left, the track list on the right, so a four-track regional doesn't
    // become a page-tall form.
    <Modal title="New Tournament" onClose={onClose} closeOnOverlayClick={false} width={advanced ? 880 : 440}>
      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{
          display: advanced ? 'grid' : 'flex',
          gridTemplateColumns: advanced ? 'minmax(0, 1fr) minmax(0, 1fr)' : undefined,
          flexDirection: 'column', alignItems: 'start', gap: advanced ? '24px' : '14px',
        }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%' }}>
        <Input
          label="Name"
          required
          charset="alpha"
          value={name}
          onChange={(e) => { setName(e.target.value); setErrors(({ name, ...rest }) => rest) }}
          error={errors.name}
          placeholder="e.g. USC Invitational"
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

        {!advanced && (
          <>
            <Combobox
              label="Location"
              required
              options={universities}
              getId={(u) => u.id}
              getLabel={(u) => u.name}
              getSearchText={(u) => `${u.name} ${u.abbreviation ?? ''}`}
              value={locationText}
              onChange={(text, matched) => { setLocationText(text); setMatchedUniversity(matched); setErrors(({ location, ...rest }) => rest) }}
              error={errors.location}
              placeholder="e.g. USC, Los Angeles CA"
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Input
                label="Start Date"
                required
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setErrors(({ startDate, ...rest }) => rest) }}
                error={errors.startDate}
                min={todayLocalDateString()}
                fullWidth
              />
              <Input
                label="End Date"
                required
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setErrors(({ endDate, ...rest }) => rest) }}
                error={errors.endDate}
                min={startDate || todayLocalDateString()}
                fullWidth
              />
            </div>
          </>
        )}

        <Combobox
          label="State"
          required
          options={STATE_OPTIONS}
          getId={(s) => s}
          getLabel={(s) => s}
          allowFreeText={false}
          value={stateText}
          onChange={(text, matched) => { setStateText(text); setMatchedState(matched); setErrors(({ state, ...rest }) => rest) }}
          error={errors.state}
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
          onChange={(text, matched) => { setLevelText(text); setMatchedLevel(matched); setErrors(({ level, ...rest }) => rest) }}
          error={errors.level}
          placeholder="e.g. Invitational"
        />

        {!advanced && (
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
                  onClick={() => { toggleDivision(d); setErrors(({ division, ...rest }) => rest) }}
                >
                  {d}
                </Button>
              ))}
            </div>
            {errors.division && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-danger)' }}>
                {errors.division}
              </p>
            )}
          </div>
        )}

        {!advanced && (
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

        {advanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
            <div>
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
              }}>
                Tracks<span style={{ color: 'var(--color-danger)' }}> *</span>
              </div>
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '4px 0 0', lineHeight: 1.5 }}>
                One per competition day, plus anything undated — test writing, review — that members sign
                up for separately. The tournament&rsquo;s dates, venue and divisions come from these.{' '}
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
                          locked={false}
                          onChange={(updates) => updateTrackRow(row.key, updates)}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {errors.tracks && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-danger)', margin: 0 }}>
                {errors.tracks}
              </p>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={addTrackRow} style={{ alignSelf: 'flex-start' }}>
              <IconPlus size={14} /> Add track
            </Button>
          </div>
        )}
        </div>

        {errors.form && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)' }}>
            {errors.form}
          </p>
        )}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <Button type="button" variant="secondary" size="md" fullWidth onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" fullWidth loading={loading}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  )
}
