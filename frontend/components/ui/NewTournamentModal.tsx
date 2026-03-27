'use client'

import { useState } from 'react'
import { tournamentsApi, Tournament } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { FieldLabel } from '@/components/ui/FieldLabel'

const inputStyle: React.CSSProperties = {
  width: '100%', height: '44px', padding: '0 14px',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-sans)', fontSize: '14px',
  color: 'var(--color-text-primary)', background: 'var(--color-bg)',
  outline: 'none', boxSizing: 'border-box',
}

interface NewTournamentModalProps {
  onClose: () => void
  onCreated: (t: Tournament) => void
}

export function NewTournamentModal({ onClose, onCreated }: NewTournamentModalProps) {
  const [name, setName]           = useState('')
  const [location, setLocation]   = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setLoading(true); setError('')
    try {
      const t = await tournamentsApi.create({
        name: name.trim(),
        location: location.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        blocks: [],
      })
      onCreated(t)
    } catch {
      setError('Failed to create tournament')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="New Tournament" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <FieldLabel>Name *</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 2026 Nationals @ USC"
            style={inputStyle}
            autoFocus
          />
        </div>
        <div>
          <FieldLabel>Location</FieldLabel>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. USC, Los Angeles CA"
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <FieldLabel>Start Date</FieldLabel>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ ...inputStyle, padding: '0 12px' }}
            />
          </div>
          <div>
            <FieldLabel>End Date</FieldLabel>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ ...inputStyle, padding: '0 12px' }}
            />
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