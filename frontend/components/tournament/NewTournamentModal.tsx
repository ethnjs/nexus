'use client'

import { useEffect, useState } from 'react'
import {
  tournamentsApi, universitiesApi, Tournament, University,
  TournamentLevel, TournamentState, TournamentDivision,
  TOURNAMENT_LEVELS, TOURNAMENT_STATES, TOURNAMENT_DIVISIONS,
} from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Combobox } from '@/components/ui/Combobox'

interface NewTournamentModalProps {
  onClose: () => void
  onCreated: (t: Tournament) => void
}

interface LevelOption { value: TournamentLevel; label: string }
const LEVEL_OPTIONS: LevelOption[] = TOURNAMENT_LEVELS.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))
const STATE_OPTIONS: TournamentState[] = [...TOURNAMENT_STATES]

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

  useEffect(() => {
    universitiesApi.list().then(setUniversities).catch(() => {})
  }, [])

  function toggleDivision(d: TournamentDivision) {
    setDivision((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fieldErrors: Record<string, string> = {}

    if (!name.trim()) fieldErrors.name = 'Name is required'
    else if (/\d/.test(name)) fieldErrors.name = 'Name must not contain numbers — the year is added automatically'

    if (!matchedUniversity && !locationText.trim()) fieldErrors.location = 'Location is required'

    if (!startDate) fieldErrors.startDate = 'Start date is required'
    else {
      // YYYY-MM-DD strings compare lexicographically in chronological order
      const today = new Date().toISOString().slice(0, 10)
      if (startDate < today) fieldErrors.startDate = 'Start date cannot be in the past'
    }
    if (!endDate) fieldErrors.endDate = 'End date is required'
    else if (startDate && endDate < startDate) fieldErrors.endDate = 'End date cannot be before start date'

    if (!matchedState) fieldErrors.state = 'State is required — pick one from the list'
    if (!matchedLevel) fieldErrors.level = 'Level is required — pick one from the list'
    if (division.length === 0) fieldErrors.division = 'Select at least one division'

    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return }

    setLoading(true); setErrors({})
    try {
      const source = matchedUniversity
        ? { university_id: matchedUniversity.id }
        : { location: locationText.trim() }
      const t = await tournamentsApi.create({
        name: name.trim(),
        short_name: shortName.trim() || null,
        start_date: startDate,
        end_date: endDate,
        state: matchedState!,
        level: matchedLevel!.value,
        division,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...source,
      })
      onCreated(t)
    } catch {
      setErrors({ form: 'Failed to create tournament' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="New Tournament" onClose={onClose} closeOnOverlayClick={false}>
      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
            min={new Date().toISOString().slice(0, 10)}
            fullWidth
          />
          <Input
            label="End Date"
            required
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setErrors(({ endDate, ...rest }) => rest) }}
            error={errors.endDate}
            fullWidth
          />
        </div>
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