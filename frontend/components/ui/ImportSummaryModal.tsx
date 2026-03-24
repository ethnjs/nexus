'use client'

import { ImportSummary } from '@/lib/importMappings'
import { Button } from '@/components/ui/Button'

interface ImportSummaryModalProps {
  summary: ImportSummary
  onClose: () => void
}

const KNOWN_FIELDS_LABELS: Record<string, string> = {
  "__ignore__":          "Ignore",
  "first_name":          "First Name",
  "last_name":           "Last Name",
  "email":               "Email",
  "phone":               "Phone",
  "shirt_size":          "Shirt Size",
  "dietary_restriction": "Dietary Restriction",
  "university":          "University",
  "major":               "Major",
  "employer":            "Employer",
  "role_preference":     "Role Preference",
  "event_preference":    "Event Preference",
  "availability":        "Availability",
  "lunch_order":         "Lunch Order",
  "notes":               "Notes",
  "extra_data":          "Extra Data",
}

const TYPE_LABELS: Record<string, string> = {
  string:          "Text",
  ignore:          "Ignore",
  boolean:         "Yes/No",
  integer:         "Number",
  multi_select:    "Multi-select",
  matrix_row:      "Availability Row",
  category_events: "Category Events",
}

function fieldLabel(field: string) {
  return KNOWN_FIELDS_LABELS[field] ?? field
}

function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type
}

function describeRow(field: string, type: string, row_key: string, extra_key: string) {
  const parts = [`${fieldLabel(field)} (${typeLabel(type)})`]
  if (row_key)   parts.push(`row: ${row_key}`)
  if (extra_key) parts.push(`key: ${extra_key}`)
  return parts.join(', ')
}

export function ImportSummaryModal({ summary, onClose }: ImportSummaryModalProps) {
  const { updated, unchanged, notInSheet, notInFile } = summary

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.35)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background:   'var(--color-surface)',
          border:       '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding:      '28px',
          width:        520,
          maxWidth:     'calc(100vw - 32px)',
          maxHeight:    '80vh',
          display:      'flex',
          flexDirection:'column',
          boxShadow:    'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <h2 style={{
          fontFamily:   'Georgia, serif',
          fontSize:     '22px',
          color:        'var(--color-text-primary)',
          marginBottom: '4px',
          flexShrink:   0,
        }}>
          Import Summary
        </h2>
        <p style={{
          fontFamily:   'var(--font-sans)',
          fontSize:     '13px',
          color:        'var(--color-text-secondary)',
          marginBottom: '20px',
          flexShrink:   0,
        }}>
          {updated.length} updated · {unchanged} unchanged · {notInSheet.length} ignored · {notInFile.length} untouched
        </p>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Updated */}
          {updated.length > 0 && (
            <Section title={`Updated (${updated.length})`} color="var(--color-text-primary)">
              {updated.map(({ header, from, to }) => (
                <div key={header} style={{
                  padding:      '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background:   'var(--color-bg)',
                  border:       '1px solid var(--color-border)',
                }}>
                  <div style={{
                    fontFamily:   'var(--font-mono)',
                    fontSize:     '12px',
                    fontWeight:   600,
                    color:        'var(--color-text-primary)',
                    marginBottom: '6px',
                  }}>
                    {header}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <DiffLine
                      label="From"
                      value={describeRow(from.field, from.type, from.row_key, from.extra_key)}
                      color="var(--color-danger)"
                      bg="var(--color-danger-subtle)"
                    />
                    <DiffLine
                      label="To"
                      value={describeRow(to.field, to.type, to.row_key, to.extra_key)}
                      color="var(--color-success)"
                      bg="#F0FDF4"
                    />
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Unchanged */}
          {unchanged > 0 && (
            <Section title={`Unchanged (${unchanged})`} color="var(--color-text-secondary)">
              <p style={{
                fontFamily: 'var(--font-sans)',
                fontSize:   '13px',
                color:      'var(--color-text-secondary)',
              }}>
                {unchanged} column{unchanged !== 1 ? 's' : ''} matched and had no changes.
              </p>
            </Section>
          )}

          {/* Not in file — in sheet but file didn't mention them */}
          {notInFile.length > 0 && (
            <Section title={`Not in file — untouched (${notInFile.length})`} color="var(--color-text-secondary)">
              <p style={{
                fontFamily:   'var(--font-sans)',
                fontSize:     '12px',
                color:        'var(--color-text-secondary)',
                marginBottom: '8px',
              }}>
                These sheet columns weren&apos;t in the import file — their mappings were left as-is.
              </p>
              <TagList items={notInFile} />
            </Section>
          )}

          {/* Not in sheet — in file but no matching header */}
          {notInSheet.length > 0 && (
            <Section title={`Not in sheet — ignored (${notInSheet.length})`} color="var(--color-text-secondary)">
              <p style={{
                fontFamily:   'var(--font-sans)',
                fontSize:     '12px',
                color:        'var(--color-text-secondary)',
                marginBottom: '8px',
              }}>
                These headers were in the import file but don&apos;t exist in the current sheet — they were ignored.
              </p>
              <TagList items={notInSheet} />
            </Section>
          )}

          {/* All good, nothing to show */}
          {updated.length === 0 && notInSheet.length === 0 && notInFile.length === 0 && (
            <p style={{
              fontFamily: 'var(--font-sans)',
              fontSize:   '13px',
              color:      'var(--color-text-secondary)',
            }}>
              All columns matched and no changes were needed.
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{ paddingTop: '20px', flexShrink: 0 }}>
          <Button variant="secondary" size="md" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  title, color, children,
}: {
  title: string; color: string; children: React.ReactNode
}) {
  return (
    <div>
      <p style={{
        fontFamily:   'var(--font-sans)',
        fontSize:     '11px',
        fontWeight:   600,
        textTransform:'uppercase',
        letterSpacing:'0.07em',
        color,
        marginBottom: '10px',
      }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {children}
      </div>
    </div>
  )
}

function DiffLine({ label, value, color, bg }: { label: string; value: string; color: string; bg: string }) {
  return (
    <div style={{
      display:      'flex',
      gap:          '8px',
      alignItems:   'baseline',
      background:   bg,
      borderRadius: 'var(--radius-sm)',
      padding:      '3px 8px',
    }}>
      <span style={{
        fontFamily:  'var(--font-sans)',
        fontSize:    '10px',
        fontWeight:  700,
        color,
        flexShrink:  0,
        width:       '28px',
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize:   '11px',
        color:      'var(--color-text-primary)',
      }}>
        {value}
      </span>
    </div>
  )
}

function TagList({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {items.map((item) => (
        <span key={item} style={{
          fontFamily:   'var(--font-mono)',
          fontSize:     '11px',
          color:        'var(--color-text-secondary)',
          background:   'var(--color-bg)',
          border:       '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          padding:      '2px 8px',
        }}>
          {item}
        </span>
      ))}
    </div>
  )
}