'use client'

import { useState } from "react"
import { CanonicalEvent, CompetitionExperience, VolunteerExperience } from "@/lib/api"
import { Input } from "@/components/ui/Input"
import { Textarea } from "@/components/ui/Textarea"
import { Button } from "@/components/ui/Button"
import { Combobox } from "@/components/ui/Combobox"
import { Modal } from "@/components/ui/Modal"
import { Tooltip } from "@/components/ui/Tooltip"
import { IconEdit, IconTrash, IconCheckCircle, IconXCircle, IconPlus } from "@/components/ui/Icons"

export type ExperienceTableMode = "view" | "view-edit" | "edit"

// -------------------------------------------------------------------------
// Shared: delete confirmation modal
// -------------------------------------------------------------------------
interface DeleteExperienceModalProps {
  itemLabel: string
  onCancel: () => void
  onConfirm: () => void
  loading?: boolean
}

function DeleteExperienceModal({ itemLabel, onCancel, onConfirm, loading }: DeleteExperienceModalProps) {
  return (
    <Modal title="Delete entry?" onClose={onCancel} width={400}>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
        This will permanently remove <strong>{itemLabel}</strong> from your profile. This can&rsquo;t be undone.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="button" variant="danger" onClick={onConfirm} loading={loading}>Delete</Button>
      </div>
    </Modal>
  )
}

// -------------------------------------------------------------------------
// Competition experience — shared draft type
// -------------------------------------------------------------------------
export interface CompetitionExperienceDraft {
  id?:        number // present if this row is already saved server-side
  school:     string
  event_id:   number | null
  event_name: string
  notes:      string
}

export function isCompetitionRowValid(row: CompetitionExperienceDraft): boolean {
  return !!row.school.trim() && row.event_id !== null
}

export function competitionExperienceToDraft(exp: CompetitionExperience): CompetitionExperienceDraft {
  return { id: exp.id, school: exp.school, event_id: exp.event.id, event_name: exp.event.name, notes: exp.notes ?? '' }
}

function emptyCompetitionDraft(): CompetitionExperienceDraft {
  return { school: '', event_id: null, event_name: '', notes: '' }
}

// -------------------------------------------------------------------------
// Competition experience — compact editor (card-stack, narrow-viewport fallback for "edit" mode)
// -------------------------------------------------------------------------
interface CompetitionExperienceCompactEditorProps {
  value:  CompetitionExperienceDraft[]
  onChange: (rows: CompetitionExperienceDraft[]) => void
  events: CanonicalEvent[]
}

export function CompetitionExperienceCompactEditor({ value, onChange, events }: CompetitionExperienceCompactEditorProps) {
  function addRow()    { onChange([...value, emptyCompetitionDraft()]) }
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
// Competition experience — unified spreadsheet component (view / view-edit / edit)
// -------------------------------------------------------------------------
interface CompetitionExperienceSpreadsheetProps {
  mode: ExperienceTableMode
  rows: CompetitionExperienceDraft[]
  events: CanonicalEvent[]

  // "edit" mode: local-only, parent owns state, diffed & saved elsewhere
  onChange?: (rows: CompetitionExperienceDraft[]) => void

  // "view-edit" mode: instant per-row CRUD
  onAdd?:    (row: CompetitionExperienceDraft) => Promise<CompetitionExperienceDraft>
  onUpdate?: (id: number, row: CompetitionExperienceDraft) => Promise<CompetitionExperienceDraft>
  onDelete?: (id: number) => Promise<void>
}

const spreadsheetCellStyle: React.CSSProperties = {
  padding: "8px 3px",
  fontFamily: "var(--font-sans)", fontSize: "13px",
  color: "var(--color-text-primary)",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "top",
};

const spreadsheetHeaderStyle: React.CSSProperties = {
  textAlign: "left", padding: "8px 3px",
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

export function CompetitionExperienceSpreadsheet({
  mode, rows, events, onChange, onAdd, onUpdate, onDelete,
}: CompetitionExperienceSpreadsheetProps) {
  // "view-edit" mode: exactly one row editable at a time. -1 means "new row being added".
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<CompetitionExperienceDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<{ index: number; row: CompetitionExperienceDraft } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isEditableMode = mode === "view-edit" || mode === "edit"

  if (rows.length === 0 && mode !== "edit") return <EmptyExperienceState />

  function startEdit(i: number) {
    setEditingIndex(i)
    setEditDraft({ ...rows[i] })
    setSaveError(undefined)
  }

  function startAdd() {
    setEditingIndex(-1)
    setEditDraft(emptyCompetitionDraft())
    setSaveError(undefined)
  }

  function cancelEdit() {
    setEditingIndex(null)
    setEditDraft(null)
    setSaveError(undefined)
  }

  async function confirmEdit() {
    if (!editDraft || !isCompetitionRowValid(editDraft)) {
      setSaveError("A school and matched event are required.")
      return
    }
    setSaving(true)
    setSaveError(undefined)
    try {
      if (editDraft.id !== undefined && onUpdate) {
        await onUpdate(editDraft.id, editDraft)
      } else if (onAdd) {
        await onAdd(editDraft)
      }
      setEditingIndex(null)
      setEditDraft(null)
    } catch {
      setSaveError("Failed to save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteTarget.row.id === undefined || !onDelete) return
    setDeleting(true)
    try {
      await onDelete(deleteTarget.row.id)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  function cellStyle(isLastRow: boolean): React.CSSProperties {
    return isLastRow ? { ...spreadsheetCellStyle, borderBottom: "none" } : spreadsheetCellStyle
  }

  function renderReadOnlyRow(row: CompetitionExperienceDraft, i: number, isLastRow: boolean) {
    const showHoverControls = mode === "view-edit" && editingIndex === null
    const cs = cellStyle(isLastRow)

    return (
      <tr
        key={row.id ?? `new-${i}`}
        style={{ position: "relative" }}
        className={showHoverControls ? "spreadsheet-row-hoverable" : undefined}
      >
        <td style={cs}>
          {showHoverControls && (
            <div className="spreadsheet-row-controls-left" style={{
              position: "absolute", left: "-34px", top: "50%", transform: "translateY(-50%)",
              opacity: 0, transition: "opacity 0.12s ease",
            }}>
              <button
                type="button"
                onClick={() => startEdit(i)}
                title="Edit"
                style={{
                  width: "26px", height: "26px", borderRadius: "6px",
                  border: "1px solid var(--color-border)", background: "var(--color-surface)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--color-text-secondary)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <IconEdit size={12} />
              </button>
            </div>
          )}
          {row.school}
        </td>
        <td style={cs}>{row.event_name}</td>
        <td style={{ ...cs, whiteSpace: "pre-wrap", position: "relative" }}>
          {row.notes || "—"}
          {showHoverControls && (
            <div className="spreadsheet-row-controls-right" style={{
              position: "absolute", right: "-34px", top: "50%", transform: "translateY(-50%)",
              opacity: 0, transition: "opacity 0.12s ease",
            }}>
              <button
                type="button"
                onClick={() => setDeleteTarget({ index: i, row })}
                title="Delete"
                style={{
                  width: "26px", height: "26px", borderRadius: "6px",
                  border: "1px solid var(--color-border)", background: "var(--color-surface)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--color-danger)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <IconTrash size={12} />
              </button>
            </div>
          )}
        </td>
      </tr>
    )
  }

  function renderEditableRow(row: CompetitionExperienceDraft, i: number, editModeFull: boolean, isLastRow: boolean) {
    const draft = editModeFull ? row : (editDraft as CompetitionExperienceDraft)
    const cs = cellStyle(isLastRow)

    function patch(p: Partial<CompetitionExperienceDraft>) {
      if (editModeFull) {
        onChange?.(rows.map((r, idx) => idx === i ? { ...r, ...p } : r))
      } else {
        setEditDraft(d => d ? { ...d, ...p } : d)
      }
    }

    return (
      <tr key={row.id ?? `editing-${i}`} style={{ position: "relative" }}>
        <td style={cs}>
          <Input type="text" value={draft.school} onChange={e => patch({ school: e.target.value })} size="sm" fullWidth />
        </td>
        <td style={cs}>
          <Combobox
            options={events}
            getId={e => e.id}
            getLabel={e => e.name}
            value={draft.event_name}
            allowFreeText={false}
            onChange={(text, matched) => patch({ event_name: text, event_id: matched ? matched.id : null })}
            size="sm"
          />
        </td>
        <td style={{ ...cs, position: "relative" }}>
          <Textarea value={draft.notes} onChange={e => patch({ notes: e.target.value })} rows={2} size="sm" />

          {!editModeFull && (
            <div style={{
              position: "absolute", right: "-74px", top: "6px",
              display: "flex", gap: "4px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "4px",
              boxShadow: "var(--shadow-sm)",
            }}>
              <Tooltip variant="error" message={saveError ?? ""} showIcon={false}>
                <button
                  type="button"
                  onClick={confirmEdit}
                  disabled={saving}
                  title="Save"
                  style={{ background: "none", border: "none", cursor: saving ? "not-allowed" : "pointer", padding: "2px", lineHeight: 0, display: "flex" }}
                >
                  {saving ? (
                    <span style={{
                      width: "22px", height: "22px",
                      border: "2px solid var(--color-border)",
                      borderTopColor: "var(--color-text-tertiary)",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "btn-spin 600ms linear infinite",
                    }} />
                  ) : (
                    <IconCheckCircle size={22} style={{ color: "var(--color-success)" }} />
                  )}
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                title="Cancel"
                style={{ background: "none", border: "none", cursor: saving ? "not-allowed" : "pointer", padding: "2px", lineHeight: 0, display: "flex" }}
              >
                <IconXCircle size={22} style={{ color: saving ? "var(--color-text-tertiary)" : "var(--color-danger)" }} />
              </button>
            </div>
          )}
        </td>
        {editModeFull && (
          <td style={{ padding: "8px 2px", textAlign: "center", verticalAlign: "middle", borderBottom: isLastRow ? "none" : "1px solid var(--color-border)" }}>
            <button
              type="button"
              onClick={() => onChange?.(rows.filter((_, idx) => idx !== i))}
              title="Remove"
              style={{
                width: "22px", height: "22px", borderRadius: "5px",
                border: "1px solid var(--color-border)", background: "var(--color-surface)",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--color-danger)",
              }}
            >
              <IconTrash size={11} />
            </button>
          </td>
        )}
      </tr>
    )
  }

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-left,
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-right {
          opacity: 1 !important;
        }
        @keyframes btn-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ overflowX: "visible" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: mode === "edit" ? "28%" : "30%" }} />
            <col style={{ width: mode === "edit" ? "23%" : "25%" }} />
            <col style={{ width: mode === "edit" ? "calc(49% - 26px)" : "45%" }} />
            {mode === "edit" && <col style={{ width: "26px" }} />}
          </colgroup>
          <thead>
            <tr>
              {["School", "Event", "Notes"].map((h) => (
                <th key={h} style={spreadsheetHeaderStyle}>{h}</th>
              ))}
              {mode === "edit" && <th style={spreadsheetHeaderStyle}></th>}
            </tr>
          </thead>
          <tbody>
            {mode === "edit"
              ? rows.map((row, i) => renderEditableRow(row, i, true, i === rows.length - 1 && editingIndex !== -1))
              : rows.map((row, i) => {
                  const isLastRow = i === rows.length - 1 && !(mode === "view-edit" && editingIndex === -1)
                  return editingIndex === i
                    ? renderEditableRow(row, i, false, isLastRow)
                    : renderReadOnlyRow(row, i, isLastRow)
                })
            }
            {mode === "view-edit" && editingIndex === -1 && editDraft && (
              renderEditableRow(editDraft, rows.length, false, true)
            )}
          </tbody>
        </table>
      </div>

      {isEditableMode && (mode !== "view-edit" || editingIndex === null) && (
        <button
          type="button"
          onClick={mode === "edit" ? () => onChange?.([...rows, emptyCompetitionDraft()]) : startAdd}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            width: "100%", padding: "8px", marginTop: "4px",
            border: "1px dashed var(--color-border)", borderRadius: "var(--radius-sm)",
            background: "transparent", cursor: "pointer",
            fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; e.currentTarget.style.color = "var(--color-accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; e.currentTarget.style.color = "var(--color-text-tertiary)"; }}
        >
          <IconPlus size={12} />
          Add row
        </button>
      )}

      {rows.length === 0 && mode === "edit" && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
          No rows yet — click below to add one.
        </p>
      )}

      {deleteTarget && (
        <DeleteExperienceModal
          itemLabel={deleteTarget.row.event_name || deleteTarget.row.school}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          loading={deleting}
        />
      )}
    </div>
  )
}

// -------------------------------------------------------------------------
// Volunteer experience — shared draft type
// -------------------------------------------------------------------------
export interface VolunteerExperienceDraft {
  id?:             number // present if this row is already saved server-side
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

export function volunteerExperienceToDraft(exp: VolunteerExperience): VolunteerExperienceDraft {
  return {
    id: exp.id,
    tournament_name: exp.tournament_name,
    year: String(exp.year),
    event_id: exp.event?.id ?? null,
    event_name: exp.event?.name ?? exp.notes?.event ?? '',
    role: exp.role,
    notes_other: exp.notes?.other ?? '',
  }
}

function emptyVolunteerDraft(): VolunteerExperienceDraft {
  return { tournament_name: '', year: '', event_id: null, event_name: '', role: '', notes_other: '' }
}

// -------------------------------------------------------------------------
// Volunteer experience — compact editor (card-stack, narrow-viewport fallback for "edit" mode)
// -------------------------------------------------------------------------
interface VolunteerExperienceCompactEditorProps {
  value:  VolunteerExperienceDraft[]
  onChange: (rows: VolunteerExperienceDraft[]) => void
  events: CanonicalEvent[]
}

export function VolunteerExperienceCompactEditor({ value, onChange, events }: VolunteerExperienceCompactEditorProps) {
  function addRow()    { onChange([...value, emptyVolunteerDraft()]) }
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
// Volunteer experience — unified spreadsheet component (view / view-edit / edit)
// -------------------------------------------------------------------------
interface VolunteerExperienceSpreadsheetProps {
  mode: ExperienceTableMode
  rows: VolunteerExperienceDraft[]
  events: CanonicalEvent[]

  onChange?: (rows: VolunteerExperienceDraft[]) => void

  onAdd?:    (row: VolunteerExperienceDraft) => Promise<VolunteerExperienceDraft>
  onUpdate?: (id: number, row: VolunteerExperienceDraft) => Promise<VolunteerExperienceDraft>
  onDelete?: (id: number) => Promise<void>
}

export function VolunteerExperienceSpreadsheet({
  mode, rows, events, onChange, onAdd, onUpdate, onDelete,
}: VolunteerExperienceSpreadsheetProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<VolunteerExperienceDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<{ index: number; row: VolunteerExperienceDraft } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const isEditableMode = mode === "view-edit" || mode === "edit"

  if (rows.length === 0 && mode !== "edit") return <EmptyExperienceState />

  function startEdit(i: number) {
    setEditingIndex(i)
    setEditDraft({ ...rows[i] })
    setSaveError(undefined)
  }

  function startAdd() {
    setEditingIndex(-1)
    setEditDraft(emptyVolunteerDraft())
    setSaveError(undefined)
  }

  function cancelEdit() {
    setEditingIndex(null)
    setEditDraft(null)
    setSaveError(undefined)
  }

  async function confirmEdit() {
    if (!editDraft || !isVolunteerRowValid(editDraft)) {
      setSaveError("Tournament name, a 4-digit year, and a role are required.")
      return
    }
    setSaving(true)
    setSaveError(undefined)
    try {
      if (editDraft.id !== undefined && onUpdate) {
        await onUpdate(editDraft.id, editDraft)
      } else if (onAdd) {
        await onAdd(editDraft)
      }
      setEditingIndex(null)
      setEditDraft(null)
    } catch {
      setSaveError("Failed to save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteTarget.row.id === undefined || !onDelete) return
    setDeleting(true)
    try {
      await onDelete(deleteTarget.row.id)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  function cellStyle(isLastRow: boolean): React.CSSProperties {
    return isLastRow ? { ...spreadsheetCellStyle, borderBottom: "none" } : spreadsheetCellStyle
  }

  function renderReadOnlyRow(row: VolunteerExperienceDraft, i: number, isLastRow: boolean) {
    const showHoverControls = mode === "view-edit" && editingIndex === null
    const cs = cellStyle(isLastRow)

    return (
      <tr
        key={row.id ?? `new-${i}`}
        style={{ position: "relative" }}
        className={showHoverControls ? "spreadsheet-row-hoverable" : undefined}
      >
        <td style={cs}>
          {showHoverControls && (
            <div className="spreadsheet-row-controls-left" style={{
              position: "absolute", left: "-34px", top: "50%", transform: "translateY(-50%)",
              opacity: 0, transition: "opacity 0.12s ease",
            }}>
              <button
                type="button"
                onClick={() => startEdit(i)}
                title="Edit"
                style={{
                  width: "26px", height: "26px", borderRadius: "6px",
                  border: "1px solid var(--color-border)", background: "var(--color-surface)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--color-text-secondary)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <IconEdit size={12} />
              </button>
            </div>
          )}
          {row.year}
        </td>
        <td style={cs}>{row.tournament_name}</td>
        <td style={cs}>{row.event_name || "—"}</td>
        <td style={cs}>{row.role}</td>
        <td style={{ ...cs, whiteSpace: "pre-wrap", position: "relative" }}>
          {row.notes_other || "—"}
          {showHoverControls && (
            <div className="spreadsheet-row-controls-right" style={{
              position: "absolute", right: "-34px", top: "50%", transform: "translateY(-50%)",
              opacity: 0, transition: "opacity 0.12s ease",
            }}>
              <button
                type="button"
                onClick={() => setDeleteTarget({ index: i, row })}
                title="Delete"
                style={{
                  width: "26px", height: "26px", borderRadius: "6px",
                  border: "1px solid var(--color-border)", background: "var(--color-surface)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--color-danger)",
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <IconTrash size={12} />
              </button>
            </div>
          )}
        </td>
      </tr>
    )
  }

  function renderEditableRow(row: VolunteerExperienceDraft, i: number, editModeFull: boolean, isLastRow: boolean) {
    const draft = editModeFull ? row : (editDraft as VolunteerExperienceDraft)
    const cs = cellStyle(isLastRow)

    function patch(p: Partial<VolunteerExperienceDraft>) {
      if (editModeFull) {
        onChange?.(rows.map((r, idx) => idx === i ? { ...r, ...p } : r))
      } else {
        setEditDraft(d => d ? { ...d, ...p } : d)
      }
    }

    return (
      <tr key={row.id ?? `editing-${i}`} style={{ position: "relative" }}>
        <td style={cs}>
          <Input
            type="text"
            value={draft.year}
            onChange={e => patch({ year: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            size="sm"
            fullWidth
          />
        </td>
        <td style={cs}>
          <Input type="text" value={draft.tournament_name} onChange={e => patch({ tournament_name: e.target.value })} size="sm" fullWidth />
        </td>
        <td style={cs}>
          <Combobox
            options={events}
            getId={e => e.id}
            getLabel={e => e.name}
            value={draft.event_name}
            allowFreeText
            onChange={(text, matched) => patch({ event_name: text, event_id: matched ? matched.id : null })}
            size="sm"
          />
        </td>
        <td style={cs}>
          <Input type="text" value={draft.role} onChange={e => patch({ role: e.target.value })} size="sm" fullWidth />
        </td>
        <td style={{ ...cs, position: "relative" }}>
          <Textarea value={draft.notes_other} onChange={e => patch({ notes_other: e.target.value })} rows={2} size="sm" />

          {!editModeFull && (
            <div style={{
              position: "absolute", right: "-74px", top: "6px",
              display: "flex", gap: "4px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "4px",
              boxShadow: "var(--shadow-sm)",
            }}>
              <Tooltip variant="error" message={saveError ?? ""} showIcon={false}>
                <button
                  type="button"
                  onClick={confirmEdit}
                  disabled={saving}
                  title="Save"
                  style={{ background: "none", border: "none", cursor: saving ? "not-allowed" : "pointer", padding: "2px", lineHeight: 0, display: "flex" }}
                >
                  {saving ? (
                    <span style={{
                      width: "22px", height: "22px",
                      border: "2px solid var(--color-border)",
                      borderTopColor: "var(--color-text-tertiary)",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "btn-spin 600ms linear infinite",
                    }} />
                  ) : (
                    <IconCheckCircle size={22} style={{ color: "var(--color-success)" }} />
                  )}
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                title="Cancel"
                style={{ background: "none", border: "none", cursor: saving ? "not-allowed" : "pointer", padding: "2px", lineHeight: 0, display: "flex" }}
              >
                <IconXCircle size={22} style={{ color: saving ? "var(--color-text-tertiary)" : "var(--color-danger)" }} />
              </button>
            </div>
          )}
        </td>
        {editModeFull && (
          <td style={{ padding: "8px 2px", textAlign: "center", verticalAlign: "middle", borderBottom: isLastRow ? "none" : "1px solid var(--color-border)" }}>
            <button
              type="button"
              onClick={() => onChange?.(rows.filter((_, idx) => idx !== i))}
              title="Remove"
              style={{
                width: "22px", height: "22px", borderRadius: "5px",
                border: "1px solid var(--color-border)", background: "var(--color-surface)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--color-danger)",
                margin: "0 auto",
              }}
            >
              <IconTrash size={11} />
            </button>
          </td>
        )}
      </tr>
    )
  }

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-left,
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-right {
          opacity: 1 !important;
        }
        @keyframes btn-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ overflowX: "visible" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: mode === "edit" ? "9%" : "10%" }} />
            <col style={{ width: mode === "edit" ? "18%" : "20%" }} />
            <col style={{ width: mode === "edit" ? "16%" : "18%" }} />
            <col style={{ width: mode === "edit" ? "13%" : "14%" }} />
            <col style={{ width: mode === "edit" ? "calc(44% - 26px)" : "38%" }} />
            {mode === "edit" && <col style={{ width: "26px" }} />}
          </colgroup>
          <thead>
            <tr>
              {["Year", "Tournament", "Event", "Role", "Notes"].map((h) => (
                <th key={h} style={spreadsheetHeaderStyle}>{h}</th>
              ))}
              {mode === "edit" && <th style={spreadsheetHeaderStyle}></th>}
            </tr>
          </thead>
          <tbody>
            {mode === "edit"
              ? rows.map((row, i) => renderEditableRow(row, i, true, i === rows.length - 1 && editingIndex !== -1))
              : rows.map((row, i) => {
                  const isLastRow = i === rows.length - 1 && !(mode === "view-edit" && editingIndex === -1)
                  return editingIndex === i
                    ? renderEditableRow(row, i, false, isLastRow)
                    : renderReadOnlyRow(row, i, isLastRow)
                })
            }
            {mode === "view-edit" && editingIndex === -1 && editDraft && (
              renderEditableRow(editDraft, rows.length, false, true)
            )}
          </tbody>
        </table>
      </div>

      {isEditableMode && (mode !== "view-edit" || editingIndex === null) && (
        <button
          type="button"
          onClick={mode === "edit" ? () => onChange?.([...rows, emptyVolunteerDraft()]) : startAdd}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
            width: "100%", padding: "8px", marginTop: "4px",
            border: "1px dashed var(--color-border)", borderRadius: "var(--radius-sm)",
            background: "transparent", cursor: "pointer",
            fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; e.currentTarget.style.color = "var(--color-accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; e.currentTarget.style.color = "var(--color-text-tertiary)"; }}
        >
          <IconPlus size={11} />
          Add row
        </button>
      )}

      {rows.length === 0 && mode === "edit" && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "8px" }}>
          No rows yet — click below to add one.
        </p>
      )}

      {deleteTarget && (
        <DeleteExperienceModal
          itemLabel={deleteTarget.row.tournament_name}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          loading={deleting}
        />
      )}
    </div>
  )
}