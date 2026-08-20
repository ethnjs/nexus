'use client'

import { useState } from 'react'
import { formsApi, Form, ApiError } from '@/lib/api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface NewFormModalProps {
  tournamentId: number
  onClose: () => void
  onCreated: (form: Form) => void
}

// Name only — no template/preset picker. Every form starts blank, including
// reserved-key presets, which the TD adds field-by-field once inside the
// builder. title/description are set later, inside the builder.
export function NewFormModal({ tournamentId, onClose, onCreated }: NewFormModalProps) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Name is required'); return }

    setLoading(true); setError(undefined)
    try {
      const form = await formsApi.createForTournament(tournamentId, { name: trimmed })
      onCreated(form)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create form')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="New Form" onClose={onClose} closeOnOverlayClick={false}>
      <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input
          label="Name"
          required
          value={name}
          onChange={(e) => { setName(e.target.value); setError(undefined) }}
          error={error}
          placeholder="e.g. Volunteer Interest Form"
          fullWidth
          autoFocus
        />
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
