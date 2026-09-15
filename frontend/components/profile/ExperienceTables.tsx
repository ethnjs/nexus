'use client'

import { ReactNode, useState } from "react"
import { CanonicalEvent, CompetitionExperience, VolunteerExperience } from "@/lib/api"
import { useIsMobile } from "@/lib/useIsMobile"
import { Input } from "@/components/ui/Input"
import { Textarea } from "@/components/ui/Textarea"
import { Button } from "@/components/ui/Button"
import { Combobox } from "@/components/ui/Combobox"
import { Modal } from "@/components/ui/Modal"
import { Tooltip } from "@/components/ui/Tooltip"
import { IconEdit, IconTrash, IconCheckCircle, IconXCircle, IconPlus, IconSave } from "@/components/ui/Icons"

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

function emptyCompetitionDraft(school = ''): CompetitionExperienceDraft {
  return { school, event_id: null, event_name: '', notes: '' }
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

// -------------------------------------------------------------------------
// Mobile: one card per row instead of a table
// -------------------------------------------------------------------------
// A five-column table leaves roughly 70px a column on a phone, and the
// view-edit controls are worse than cramped — they're hover-revealed at
// left:-34px / right:-34px, so a touch device can neither hover them nor fit
// them on screen. The cards below carry the same controls as plain visible
// buttons.
//
// This one switch stays in JS rather than moving to a media query like the
// app frame did: the two arrangements are different elements, not different
// styling, and rendering both would mount a second live copy of every input
// in the editing card. It sits well below the fold, so the one-frame
// correction after hydration isn't visible.

const experienceCardStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  background: "var(--color-surface)",
  padding: "12px",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const cardLabelStyle: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "10px", fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.06em",
  color: "var(--color-text-tertiary)",
};

/** A saved row: bold heading, labelled fields, controls pinned to the top row. */
function ExperienceCard({ title, controls, children }: {
  title: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={experienceCardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <div style={{
          flex: 1, minWidth: 0, overflowWrap: "break-word",
          fontFamily: "var(--font-sans)", fontSize: "14px", fontWeight: 600,
          color: "var(--color-text-primary)",
        }}>
          {title}
        </div>
        {controls && (
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>{controls}</div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{children}</div>
    </div>
  );
}

/** One label/value pair inside a saved card. */
function CardField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "62px 1fr", gap: "10px", alignItems: "baseline" }}>
      <span style={cardLabelStyle}>{label}</span>
      <span style={{
        minWidth: 0, overflowWrap: "break-word", whiteSpace: "pre-wrap",
        fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-primary)",
      }}>
        {value}
      </span>
    </div>
  );
}

/** One labelled input inside an editing card — stacked, not side by side. */
function CardEditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={cardLabelStyle}>{label}</span>
      {children}
    </div>
  );
}

/** The action row under an editing card. */
function CardEditActions({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>{children}</div>;
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
  const isMobile = useIsMobile()

  const isEditableMode = mode === "view-edit" || mode === "edit"
  const useCards = isMobile

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

  async function saveDraft(): Promise<boolean> {
    if (!editDraft || !isCompetitionRowValid(editDraft)) {
      setSaveError("A school and matched event are required.")
      return false
    }
    setSaving(true)
    setSaveError(undefined)
    try {
      if (editDraft.id !== undefined && onUpdate) {
        await onUpdate(editDraft.id, editDraft)
      } else if (onAdd) {
        await onAdd(editDraft)
      }
      return true
    } catch {
      setSaveError("Failed to save. Try again.")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function confirmEdit() {
    const ok = await saveDraft()
    if (ok) {
      setEditingIndex(null)
      setEditDraft(null)
    }
  }

  // Saves the row currently being edited, then opens a fresh row prefilled
  // with the same school so the user doesn't have to retype it.
  async function addAnotherForSchool() {
    const school = editDraft?.school
    const ok = await saveDraft()
    if (ok && school) {
      setEditingIndex(-1)
      setEditDraft(emptyCompetitionDraft(school))
    }
  }

  // Bulk "edit" mode: rows are local drafts, no save round-trip needed.
  function addAnotherForSchoolBulk(i: number) {
    const school = rows[i].school
    onChange?.([...rows.slice(0, i + 1), emptyCompetitionDraft(school), ...rows.slice(i + 1)])
  }

  // "view-edit" mode: from a saved (read-only) row, jump straight into adding
  // a new row prefilled with that row's school.
  function addAnotherForSchoolFromRow(i: number) {
    setEditingIndex(-1)
    setEditDraft(emptyCompetitionDraft(rows[i].school))
    setSaveError(undefined)
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteTarget.row.id === undefined || !onDelete) return
    setDeleting(true)
    try {
      await onDelete(deleteTarget.row.id)
      setDeleteTarget(null)
      setEditingIndex(null)
      setEditDraft(null)
    } finally {
      setDeleting(false)
    }
  }

  function cellStyle(isLastRow: boolean): React.CSSProperties {
    return isLastRow ? { ...spreadsheetCellStyle, borderBottom: "none" } : spreadsheetCellStyle
  }

  // ── Mobile cards ────────────────────────────────────────────────────────

  function renderCardControls(row: CompetitionExperienceDraft, i: number) {
    if (mode !== "view-edit" || editingIndex !== null) return null
    return (
      <>
        <Button type="button" variant="secondary" size="xs" iconOnly onClick={() => startEdit(i)} title="Edit" aria-label="Edit">
          <IconEdit size={12} />
        </Button>
        <Button
          type="button" variant="secondary" size="xs" iconOnly
          onClick={() => addAnotherForSchoolFromRow(i)}
          title="Add another event for this school"
          aria-label="Add another event for this school"
        >
          <IconPlus size={12} />
        </Button>
        <Button
          type="button" variant="secondary" size="xs" iconOnly
          onClick={() => setDeleteTarget({ index: i, row })}
          title="Delete" aria-label="Delete"
          style={{ color: "var(--color-danger)" }}
        >
          <IconTrash size={12} />
        </Button>
      </>
    )
  }

  // `editModeFull` mirrors renderEditableRow: bulk "edit" mode edits the row
  // in place through onChange with no save round-trip, while "view-edit"
  // edits a draft and commits it.
  function renderEditCard(draft: CompetitionExperienceDraft, i: number, key: string, editModeFull = false) {
    const valid = isCompetitionRowValid(draft)

    function patch(p: Partial<CompetitionExperienceDraft>) {
      if (editModeFull) {
        onChange?.(rows.map((r, idx) => idx === i ? { ...r, ...p } : r))
      } else {
        setEditDraft(d => d ? { ...d, ...p } : d)
      }
    }

    return (
      <div key={key} style={experienceCardStyle}>
        <CardEditField label="School">
          <Input type="text" value={draft.school} onChange={e => patch({ school: e.target.value })} size="sm" fullWidth />
        </CardEditField>
        <CardEditField label="Event">
          <Combobox
            options={events}
            getId={e => e.id}
            getLabel={e => e.name}
            value={draft.event_name}
            allowFreeText={false}
            onChange={(text, matched) => patch({ event_name: text, event_id: matched ? matched.id : null })}
            size="sm"
          />
        </CardEditField>
        <CardEditField label="Notes">
          <Textarea value={draft.notes} onChange={e => patch({ notes: e.target.value })} rows={2} size="sm" fullWidth />
        </CardEditField>

        {/* The desktop row puts this in a Tooltip on a hover-revealed button;
            with no hover to carry it, the message has to be on the page.
            Bulk edit mode has no save step, so nothing to warn about yet. */}
        {!editModeFull && (saveError || !valid) && (
          <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
            {saveError ?? "A school and matched event are required."}
          </p>
        )}

        <CardEditActions>
          {editModeFull ? (
            <>
              <Button
                type="button" variant="secondary" size="sm"
                onClick={() => addAnotherForSchoolBulk(i)}
                disabled={!draft.school.trim()}
              >
                <IconPlus size={13} />
                Another for this school
              </Button>
              <Button
                type="button" variant="secondary" size="sm"
                onClick={() => onChange?.(rows.filter((_, idx) => idx !== i))}
                style={{ color: "var(--color-danger)" }}
              >
                Remove
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="primary" size="sm" onClick={confirmEdit} loading={saving} disabled={!valid}>
                Save
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={addAnotherForSchool} disabled={saving || !valid}>
                Save &amp; add another
              </Button>
              <Button
                type="button" variant="secondary" size="sm" disabled={saving}
                onClick={() => draft.id !== undefined ? setDeleteTarget({ index: i, row: draft }) : cancelEdit()}
                style={{ color: "var(--color-danger)" }}
              >
                {draft.id !== undefined ? "Delete" : "Cancel"}
              </Button>
            </>
          )}
        </CardEditActions>
      </div>
    )
  }

  function renderCards() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {/* Bulk edit: every row is an open editor, as the table's rows are. */}
        {mode === "edit"
          ? rows.map((row, i) => renderEditCard(row, i, `bulk-${i}`, true))
          : rows.map((row, i) => (
              editingIndex === i && editDraft
                ? renderEditCard(editDraft, i, `editing-${row.id ?? i}`)
                : (
                  <ExperienceCard key={row.id ?? `row-${i}`} title={row.school} controls={renderCardControls(row, i)}>
                    <CardField label="Event" value={row.event_name} />
                    <CardField label="Notes" value={row.notes || "—"} />
                  </ExperienceCard>
                )
            ))}
        {mode === "view-edit" && editingIndex === -1 && editDraft && (
          renderEditCard(editDraft, rows.length, "editing-new")
        )}
      </div>
    )
  }

  // ── Desktop table ───────────────────────────────────────────────────────

  function renderReadOnlyRow(row: CompetitionExperienceDraft, i: number, isLastRow: boolean) {
    const showHoverControls = mode === "view-edit" && editingIndex === null
    const cs = cellStyle(isLastRow)

    return (
      <tr
        key={row.id ?? `new-${i}`}
        style={{ position: "relative" }}
        className={`spreadsheet-row-bg-hover${showHoverControls ? " spreadsheet-row-hoverable" : ""}`}
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
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span>{row.school}</span>
            {showHoverControls && (
              <button
                type="button"
                className="spreadsheet-row-controls-mid"
                onClick={() => addAnotherForSchoolFromRow(i)}
                title="Add another event for this school"
                style={{
                  flexShrink: 0,
                  width: "20px", height: "20px", borderRadius: "5px",
                  border: "1px solid var(--color-border)", background: "var(--color-surface)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--color-text-secondary)",
                  opacity: 0, transition: "opacity 0.12s ease",
                }}
              >
                <IconPlus size={10} />
              </button>
            )}
          </div>
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

    // In view-edit mode, both save and "add another" require a full valid
    // row (school + matched event) before they're usable. In bulk edit mode
    // there's no save step, so just require a school to copy.
    const canAddAnother = editModeFull ? !!draft.school.trim() : isCompetitionRowValid(draft)
    const addAnotherDisabled = editModeFull ? !canAddAnother : (saving || !canAddAnother)

    return (
      <tr key={row.id ?? `editing-${i}`} style={{ position: "relative" }}>
        <td style={cs}>
          {editModeFull ? (
            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input type="text" value={draft.school} onChange={e => patch({ school: e.target.value })} size="sm" fullWidth />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                iconOnly
                onClick={() => addAnotherForSchoolBulk(i)}
                disabled={addAnotherDisabled}
                title="Add another event for this school"
                style={{ flexShrink: 0 }}
              >
                <IconPlus size={13} />
              </Button>
            </div>
          ) : (
            <Input type="text" value={draft.school} onChange={e => patch({ school: e.target.value })} size="sm" fullWidth />
          )}
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
          <Textarea value={draft.notes} onChange={e => patch({ notes: e.target.value })} rows={1} size="sm" expandable />

          {!editModeFull && (
            <div style={{
              position: "absolute", right: "-104px", top: "6px",
              display: "flex", gap: "4px",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              padding: "4px",
              boxShadow: "var(--shadow-sm)",
            }}>
              <Tooltip variant="error" message={!isCompetitionRowValid(draft) ? "Must add a school and event" : (saveError ?? "")} showIcon={false}>
                <button
                  type="button"
                  onClick={confirmEdit}
                  disabled={saving || !isCompetitionRowValid(draft)}
                  title="Save"
                  style={{ background: "none", border: "none", cursor: (saving || !isCompetitionRowValid(draft)) ? "not-allowed" : "pointer", padding: "2px", lineHeight: 0, display: "flex" }}
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
                    <IconSave size={20} style={{ color: isCompetitionRowValid(draft) ? "var(--color-text-secondary)" : "var(--color-text-tertiary)" }} />
                  )}
                </button>
              </Tooltip>
              <Tooltip variant="error" message={!isCompetitionRowValid(draft) ? "Must add a school and event" : ""} showIcon={false}>
                <button
                  type="button"
                  onClick={addAnotherForSchool}
                  disabled={saving || !isCompetitionRowValid(draft)}
                  title="Save and add another event for this school"
                  style={{ background: "none", border: "none", cursor: (saving || !isCompetitionRowValid(draft)) ? "not-allowed" : "pointer", padding: "2px", lineHeight: 0, display: "flex" }}
                >
                  <IconPlus size={20} style={{ color: isCompetitionRowValid(draft) ? "var(--color-text-secondary)" : "var(--color-text-tertiary)" }} />
                </button>
              </Tooltip>
              <button
                type="button"
                onClick={() => draft.id !== undefined ? setDeleteTarget({ index: i, row: draft }) : cancelEdit()}
                disabled={saving}
                title="Delete"
                style={{ background: "none", border: "none", cursor: saving ? "not-allowed" : "pointer", padding: "2px", lineHeight: 0, display: "flex" }}
              >
                <IconTrash size={20} style={{ color: saving ? "var(--color-text-tertiary)" : "var(--color-danger)" }} />
              </button>
            </div>
          )}
        </td>
        {editModeFull && (
          <td style={{ padding: "8px 2px", textAlign: "center", verticalAlign: "middle", borderBottom: isLastRow ? "none" : "1px solid var(--color-border)" }}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconOnly
              onClick={() => onChange?.(rows.filter((_, idx) => idx !== i))}
              title="Remove"
              style={{ color: "var(--color-danger)" }}
            >
              <IconTrash size={13} />
            </Button>
          </td>
        )}
      </tr>
    )
  }

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        .spreadsheet-row-bg-hover {
          background: transparent;
          transition: background 100ms ease;
        }
        .spreadsheet-row-bg-hover:hover {
          background: var(--color-bg);
        }
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-left,
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-right,
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-mid {
          opacity: 1 !important;
        }
        @keyframes btn-spin { to { transform: rotate(360deg); } }
      `}</style>

      {useCards ? renderCards() : (
      <div style={{ overflowX: "visible" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: mode === "edit" ? "41%" : "42%" }} />
            <col style={{ width: mode === "edit" ? "34%" : "35%" }} />
            <col style={{ width: mode === "edit" ? "calc(25% - 32px)" : "23%" }} />
            {mode === "edit" && <col style={{ width: "32px" }} />}
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
      )}

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
  const isMobile = useIsMobile()

  const isEditableMode = mode === "view-edit" || mode === "edit"
  const useCards = isMobile

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

  // ── Mobile cards ────────────────────────────────────────────────────────

  function renderCardControls(row: VolunteerExperienceDraft, i: number) {
    if (mode !== "view-edit" || editingIndex !== null) return null
    return (
      <>
        <Button type="button" variant="secondary" size="xs" iconOnly onClick={() => startEdit(i)} title="Edit" aria-label="Edit">
          <IconEdit size={12} />
        </Button>
        <Button
          type="button" variant="secondary" size="xs" iconOnly
          onClick={() => setDeleteTarget({ index: i, row })}
          title="Delete" aria-label="Delete"
          style={{ color: "var(--color-danger)" }}
        >
          <IconTrash size={12} />
        </Button>
      </>
    )
  }

  // `editModeFull` mirrors renderEditableRow: bulk "edit" mode edits the row
  // in place through onChange with no save round-trip, while "view-edit"
  // edits a draft and commits it.
  function renderEditCard(draft: VolunteerExperienceDraft, i: number, key: string, editModeFull = false) {
    function patch(p: Partial<VolunteerExperienceDraft>) {
      if (editModeFull) {
        onChange?.(rows.map((r, idx) => idx === i ? { ...r, ...p } : r))
      } else {
        setEditDraft(d => d ? { ...d, ...p } : d)
      }
    }

    return (
      <div key={key} style={experienceCardStyle}>
        <CardEditField label="Tournament">
          <Input type="text" charset="alpha" value={draft.tournament_name} onChange={e => patch({ tournament_name: e.target.value })} size="sm" fullWidth />
        </CardEditField>
        <CardEditField label="Year">
          <Input type="text" charset="numeric" maxLength={4} value={draft.year} onChange={e => patch({ year: e.target.value })} size="sm" fullWidth />
        </CardEditField>
        <CardEditField label="Event">
          <Combobox
            options={events}
            getId={e => e.id}
            getLabel={e => e.name}
            value={draft.event_name}
            allowFreeText
            onChange={(text, matched) => patch({ event_name: text, event_id: matched ? matched.id : null })}
            size="sm"
          />
        </CardEditField>
        <CardEditField label="Role">
          <Input type="text" value={draft.role} onChange={e => patch({ role: e.target.value })} size="sm" fullWidth />
        </CardEditField>
        <CardEditField label="Notes">
          <Textarea value={draft.notes_other} onChange={e => patch({ notes_other: e.target.value })} rows={2} size="sm" fullWidth />
        </CardEditField>

        {/* The desktop row hangs this off a Tooltip on a hover-revealed
            button; with no hover to carry it, it has to be on the page. */}
        {!editModeFull && saveError && (
          <p style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-danger)" }}>
            {saveError}
          </p>
        )}

        <CardEditActions>
          {editModeFull ? (
            <Button
              type="button" variant="secondary" size="sm"
              onClick={() => onChange?.(rows.filter((_, idx) => idx !== i))}
              style={{ color: "var(--color-danger)" }}
            >
              Remove
            </Button>
          ) : (
            <>
              <Button type="button" variant="primary" size="sm" onClick={confirmEdit} loading={saving}>
                Save
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
            </>
          )}
        </CardEditActions>
      </div>
    )
  }

  function renderCards() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {/* Bulk edit: every row is an open editor, as the table's rows are. */}
        {mode === "edit"
          ? rows.map((row, i) => renderEditCard(row, i, `bulk-${i}`, true))
          : rows.map((row, i) => (
              editingIndex === i && editDraft
                ? renderEditCard(editDraft, i, `editing-${row.id ?? i}`)
                : (
                  <ExperienceCard
                    key={row.id ?? `row-${i}`}
                    title={row.tournament_name}
                    controls={renderCardControls(row, i)}
                  >
                    <CardField label="Year" value={row.year} />
                    <CardField label="Event" value={row.event_name || "—"} />
                    <CardField label="Role" value={row.role} />
                    <CardField label="Notes" value={row.notes_other || "—"} />
                  </ExperienceCard>
                )
            ))}
        {mode === "view-edit" && editingIndex === -1 && editDraft && (
          renderEditCard(editDraft, rows.length, "editing-new")
        )}
      </div>
    )
  }

  // ── Desktop table ───────────────────────────────────────────────────────

  function renderReadOnlyRow(row: VolunteerExperienceDraft, i: number, isLastRow: boolean) {
    const showHoverControls = mode === "view-edit" && editingIndex === null
    const cs = cellStyle(isLastRow)

    return (
      <tr
        key={row.id ?? `new-${i}`}
        style={{ position: "relative" }}
        className={`spreadsheet-row-bg-hover${showHoverControls ? " spreadsheet-row-hoverable" : ""}`}
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
            charset="numeric"
            maxLength={4}
            value={draft.year}
            onChange={e => patch({ year: e.target.value })}
            size="sm"
            fullWidth
          />
        </td>
        <td style={cs}>
          <Input type="text" charset="alpha" value={draft.tournament_name} onChange={e => patch({ tournament_name: e.target.value })} size="sm" fullWidth />
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
          <Textarea value={draft.notes_other} onChange={e => patch({ notes_other: e.target.value })} rows={1} size="sm" expandable />

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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconOnly
              onClick={() => onChange?.(rows.filter((_, idx) => idx !== i))}
              title="Remove"
              style={{ color: "var(--color-danger)", margin: "0 auto" }}
            >
              <IconTrash size={13} />
            </Button>
          </td>
        )}
      </tr>
    )
  }

  return (
    <div style={{ position: "relative" }}>
      <style>{`
        .spreadsheet-row-bg-hover {
          background: transparent;
          transition: background 100ms ease;
        }
        .spreadsheet-row-bg-hover:hover {
          background: var(--color-bg);
        }
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-left,
        .spreadsheet-row-hoverable:hover .spreadsheet-row-controls-right {
          opacity: 1 !important;
        }
        @keyframes btn-spin { to { transform: rotate(360deg); } }
      `}</style>

      {useCards ? renderCards() : (
      <div style={{ overflowX: "visible" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: mode === "edit" ? "8%" : "8%" }} />
            <col style={{ width: mode === "edit" ? "30%" : "31%" }} />
            <col style={{ width: mode === "edit" ? "22%" : "23%" }} />
            <col style={{ width: mode === "edit" ? "18%" : "18%" }} />
            <col style={{ width: mode === "edit" ? "calc(22% - 26px)" : "20%" }} />
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
      )}

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