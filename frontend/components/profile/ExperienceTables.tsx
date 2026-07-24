'use client'

import { CanonicalEvent } from "@/lib/api"
import { Input } from "@/components/ui/Input"
import { Textarea } from "@/components/ui/Textarea"
import { Button } from "@/components/ui/Button"
import { Combobox } from "@/components/ui/Combobox"

// -------------------------------------------------------------------------
// Competition experience — edit
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
// Volunteer experience — edit
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

// -------------------------------------------------------------------------
// Shared view-table cell style
// -------------------------------------------------------------------------
const viewCellStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
  color: "var(--color-text-primary)",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
};

const viewHeaderStyle: React.CSSProperties = {
  textAlign: "left", padding: "8px 12px",
  fontFamily: "var(--font-sans)", fontSize: "11px", fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.06em",
  color: "var(--color-text-tertiary)",
  borderBottom: "1px solid var(--color-border)",
};

function EmptyExperienceState() {
  return (
    <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
      No experience added yet
    </p>
  );
}

// -------------------------------------------------------------------------
// Competition experience — view
// -------------------------------------------------------------------------
interface CompetitionExperienceRow {
  id: number;
  event: { name: string };
  school: string;
  notes: string | null;
}

export function CompetitionExperienceTableView({ rows }: { rows: CompetitionExperienceRow[] }) {
  if (rows.length === 0) return <EmptyExperienceState />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "35%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "45%" }} />
        </colgroup>
        <thead>
          <tr>
            {["School", "Event", "Notes"].map((h) => (
              <th key={h} style={viewHeaderStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isSameSchoolAsPrev = i > 0 && rows[i - 1].school === row.school;
            if (isSameSchoolAsPrev) {
              return (
                <tr key={row.id}>
                  <td style={viewCellStyle}>{row.event.name}</td>
                  <td style={{ ...viewCellStyle, whiteSpace: "pre-wrap" }}>{row.notes ?? "—"}</td>
                </tr>
              );
            }
            // count how many consecutive rows share this school, for rowSpan
            let span = 1;
            while (i + span < rows.length && rows[i + span].school === row.school) span++;

            return (
              <tr key={row.id}>
                <td style={viewCellStyle} rowSpan={span}>{row.school}</td>
                <td style={viewCellStyle}>{row.event.name}</td>
                <td style={{ ...viewCellStyle, whiteSpace: "pre-wrap" }}>{row.notes ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------------------
// Volunteer experience — view
// -------------------------------------------------------------------------
interface VolunteerExperienceRow {
  id: number;
  tournament_name: string;
  role: string;
  year: number;
  event: { name: string } | null;
  notes: { event?: string; other?: string } | null;
}

function volunteerEventDisplay(row: VolunteerExperienceRow): string {
  if (row.event) return row.event.name;
  if (row.notes?.event) return row.notes.event;
  return "—";
}

export function VolunteerExperienceTableView({ rows }: { rows: VolunteerExperienceRow[] }) {
  if (rows.length === 0) return <EmptyExperienceState />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "10%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "38%" }} />
        </colgroup>
        <thead>
          <tr>
            {["Year", "Tournament", "Event", "Role", "Notes"].map((h) => (
              <th key={h} style={viewHeaderStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={viewCellStyle}>{row.year}</td>
              <td style={viewCellStyle}>{row.tournament_name}</td>
              <td style={viewCellStyle}>{volunteerEventDisplay(row)}</td>
              <td style={viewCellStyle}>{row.role}</td>
              <td style={{ ...viewCellStyle, whiteSpace: "pre-wrap" }}>{row.notes?.other ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}