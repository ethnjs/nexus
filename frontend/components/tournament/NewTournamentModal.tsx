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
  const [error, setError]         = useState('')

  useEffect(() => {
    universitiesApi.list().then(setUniversities).catch(() => {})
  }, [])

  function toggleDivision(d: TournamentDivision) {
    setDivision((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (/\d/.test(name)) { setError('Name must not contain numbers — the year is added automatically'); return }
    if (!startDate || !endDate) { setError('Start and end date are required'); return }
    if (!matchedState) { setError('State is required — pick one from the list'); return }
    if (!matchedLevel) { setError('Level is required — pick one from the list'); return }
    if (division.length === 0) { setError('Select at least one division'); return }
    if (!matchedUniversity && !locationText.trim()) { setError('Location is required'); return }

    setLoading(true); setError('')
    try {
      const source = matchedUniversity
        ? { university_id: matchedUniversity.id }
        : { location: locationText.trim() }
      const t = await tournamentsApi.create({
        name: name.trim(),
        short_name: shortName.trim() || null,
        start_date: startDate,
        end_date: endDate,
        state: matchedState,
        level: matchedLevel.value,
        division,
        ...source,
      })
      onCreated(t)
    } catch {
      setError('Failed to create tournament')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="New Tournament" onClose={onClose} closeOnOverlayClick={false}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Nationals @ USC"
          fullWidth
          autoFocus
        />
        <Input
          label="Short Name"
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
          value={locationText}
          onChange={(text, matched) => { setLocationText(text); setMatchedUniversity(matched) }}
          placeholder="e.g. USC, Los Angeles CA"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Input
            label="Start Date"
            required
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            fullWidth
          />
          <Input
            label="End Date"
            required
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
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
          onChange={(text, matched) => { setStateText(text); setMatchedState(matched) }}
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
                onClick={() => toggleDivision(d)}
              >
                {d}
              </Button>
            ))}
          </div>
        </div>
        {error && (
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-danger)' }}>
            {error}
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