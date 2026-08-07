'use client'

import { useEffect, useState } from 'react'
import { tournamentsApi, universitiesApi, Tournament, University } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Combobox } from '@/components/ui/Combobox'

interface NewTournamentModalProps {
  onClose: () => void
  onCreated: (t: Tournament) => void
}

export function NewTournamentModal({ onClose, onCreated }: NewTournamentModalProps) {
  const [name, setName]           = useState('')
  const [universities, setUniversities] = useState<University[]>([])
  const [locationText, setLocationText] = useState('')
  const [matchedUniversity, setMatchedUniversity] = useState<University | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => {
    universitiesApi.list().then(setUniversities).catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true); setError('')
    try {
      const t = await tournamentsApi.create({
        name: name.trim(),
        university_id: matchedUniversity?.id ?? null,
        location: matchedUniversity ? null : (locationText.trim() || null),
        start_date: startDate || null,
        end_date: endDate || null,
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
          label="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 2026 Nationals @ USC"
          fullWidth
          autoFocus
        />
        <Combobox
          label="Location"
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
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            fullWidth
          />
          <Input
            label="End Date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            fullWidth
          />
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