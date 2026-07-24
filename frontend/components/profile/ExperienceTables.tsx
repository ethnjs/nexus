// components/experience/ExperienceTables.tsx
'use client'

import { CanonicalEvent } from "@/lib/api"
import { Input } from "@/components/ui/Input"
import { Textarea } from "@/components/ui/Textarea"
import { Button } from "@/components/ui/Button"
import { Combobox } from "@/components/ui/Combobox"

// -------------------------------------------------------------------------
// Competition experience
// -------------------------------------------------------------------------
export interface CompetitionExperienceDraft {
  school:     string
  event_id:   number | null
  event_name: string
  notes:      string
}

export function isCompetitionRowValid(row: CompetitionExperienceDraft): boolean {
  return !!row.school.trim() && row.event_id !== null
}

interface CompetitionExperienceTableProps {
  value:  CompetitionExperienceDraft[]
  onChange: (rows: CompetitionExperienceDraft[]) => void
  events: CanonicalEvent[]
}

export function CompetitionExperienceTable({ value, onChange, events }: CompetitionExperienceTableProps) {
  function addRow()    { onChange([...value, { school: '', event_id: null, event_name: '', notes: '' }]) }
  function updateRow(i: number, patch: Partial<CompetitionExperienceDraft>) {
    onChange(value.map((row, idx) => idx === i ? { ...row, ...patch } : row))
  }
  function removeRow(i: number) { onChange(value.filter((_, idx) => idx !== i)) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {value.map((row, i) => (
        <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Input label="School" type="text" value={row.school} onChange={e => updateRow(i, { school: e.target.value })} fullWidth />
          <Combobox
            label="Event"
            options={events}
            getId={e => e.id}
            getLabel={e => e.name}
            value={row.event_name}
            allowFreeText={false}
            onChange={(text, matched) => updateRow(i, { event_name: text, event_id: matched ? matched.id : null })}
          />
          <Textarea label="Notes" value={row.notes} onChange={e => updateRow(i, { notes: e.target.value })} />
          <Button type="button" variant="secondary" onClick={() => removeRow(i)}>Remove</Button>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={addRow}>+ Add competition experience</Button>
    </div>
  )
}

// -------------------------------------------------------------------------
// Volunteer experience
// -------------------------------------------------------------------------
export interface VolunteerExperienceDraft {
  tournament_name: string
  year:            string
  event_id:        number | null
  event_name:      string   // display text; also becomes notes.event if unmatched
  role:            string
  notes_other:     string
}

export function isVolunteerRowValid(row: VolunteerExperienceDraft): boolean {
  return !!row.tournament_name.trim() && /^\d{4}$/.test(row.year) && !!row.role.trim()
}

interface VolunteerExperienceTableProps {
  value:  VolunteerExperienceDraft[]
  onChange: (rows: VolunteerExperienceDraft[]) => void
  events: CanonicalEvent[]
}

export function VolunteerExperienceTable({ value, onChange, events }: VolunteerExperienceTableProps) {
  function addRow()    { onChange([...value, { tournament_name: '', year: '', event_id: null, event_name: '', role: '', notes_other: '' }]) }
  function updateRow(i: number, patch: Partial<VolunteerExperienceDraft>) {
    onChange(value.map((row, idx) => idx === i ? { ...row, ...patch } : row))
  }
  function removeRow(i: number) { onChange(value.filter((_, idx) => idx !== i)) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {value.map((row, i) => (
        <div key={i} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Input label="Tournament Name" type="text" value={row.tournament_name} onChange={e => updateRow(i, { tournament_name: e.target.value })} fullWidth />
          <Input
            label="Year"
            type="text"
            value={row.year}
            onChange={e => updateRow(i, { year: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            fullWidth
          />
          <Combobox
            label="Event"
            options={events}
            getId={e => e.id}
            getLabel={e => e.name}
            value={row.event_name}
            allowFreeText
            onChange={(text, matched) => updateRow(i, { event_name: text, event_id: matched ? matched.id : null })}
          />
          <Input label="Role" type="text" value={row.role} onChange={e => updateRow(i, { role: e.target.value })} fullWidth />
          <Textarea label="Notes" value={row.notes_other} onChange={e => updateRow(i, { notes_other: e.target.value })} />
          <Button type="button" variant="secondary" onClick={() => removeRow(i)}>Remove</Button>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={addRow}>+ Add volunteer experience</Button>
    </div>
  )
}