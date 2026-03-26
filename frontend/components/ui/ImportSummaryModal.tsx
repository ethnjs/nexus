'use client'

import { ImportSummary, RuleDiff, FieldDiff, describeRule } from '@/lib/importMappings'
import { Button } from '@/components/ui/Button'

interface ImportSummaryModalProps {
  summary: ImportSummary
  onClose: () => void
}

// ─── Rule diff row ────────────────────────────────────────────────────────────

function RuleDiffRow({ diff }: { diff: RuleDiff }) {
  const idx = diff.index + 1

  if (diff.status === 'unchanged') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '5px 8px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        opacity: 0.55,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', minWidth: '16px', flexShrink: 0 }}>
          {idx}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
          {describeRule(diff.from!)}
        </span>
      </div>
    )
  }

  if (diff.status === 'removed') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '5px 8px',
        background: '#FFF5F5', border: '1px solid #FCA5A5',
        borderRadius: 'var(--radius-sm)',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, color: '#DC2626', minWidth: '16px', flexShrink: 0 }}>
          {idx}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#DC2626', flex: 1 }}>
          {describeRule(diff.from!)}
        </span>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', color: '#DC2626', flexShrink: 0 }}>removed</span>
      </div>
    )
  }

  if (diff.status === 'added') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '5px 8px',
        background: '#F0FDF4', border: '1px solid #86EFAC',
        borderRadius: 'var(--radius-sm)',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, color: '#16A34A', minWidth: '16px', flexShrink: 0 }}>
          {idx}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#16A34A', fontWeight: 600, flex: 1 }}>
          {describeRule(diff.to!)}
        </span>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', color: '#16A34A', flexShrink: 0 }}>added</span>
      </div>
    )
  }

  // changed — single box, number column centered, red line / green line flush with divider
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
    }}>
      {/* Rule number — centered vertically across both lines */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 10px',
        background: 'var(--color-bg)',
        borderRight: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)' }}>
          {idx}
        </span>
      </div>
      {/* Stacked lines — padding on both sides so text is flush with the divider gap */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{
          padding: '5px 8px',
          background: '#FFF5F5',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#DC2626' }}>
            {describeRule(diff.from!)}
          </span>
        </div>
        <div style={{
          padding: '5px 8px',
          background: '#F0FDF4',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#16A34A', fontWeight: 600 }}>
            {describeRule(diff.to!)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Field diff row ───────────────────────────────────────────────────────────

function FieldDiffRow({ diff }: { diff: FieldDiff }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
      <span style={{
        fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'var(--color-text-tertiary)', minWidth: '72px', flexShrink: 0,
      }}>
        {diff.label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#DC2626', background: '#FFF5F5', borderRadius: '3px', padding: '1px 5px' }}>
        {diff.from}
      </span>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>→</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, color: '#16A34A', background: '#F0FDF4', borderRadius: '3px', padding: '1px 5px' }}>
        {diff.to}
      </span>
    </div>
  )
}

// ─── Updated row card ─────────────────────────────────────────────────────────

function UpdatedRowCard({ entry }: { entry: ImportSummary['updated'][0] }) {
  const { header, fieldDiffs, ruleDiffs } = entry
  const hasFieldDiffs  = fieldDiffs.length > 0
  const hasAnyRules    = ruleDiffs.length > 0
  const hasRuleChanges = ruleDiffs.some((d) => d.status !== 'unchanged')

  return (
    <div style={{
      borderRadius: 'var(--radius-sm)',
      background:   'var(--color-bg)',
      border:       '1px solid var(--color-border)',
      overflow:     'hidden',
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px', fontWeight: 600,
        color: 'var(--color-text-primary)',
      }}>
        {header}
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {hasFieldDiffs && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {fieldDiffs.map((diff) => <FieldDiffRow key={diff.label} diff={diff} />)}
          </div>
        )}
        {hasAnyRules && (
          <div>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: '6px' }}>
              Parse Rules{!hasRuleChanges && ' (unchanged)'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {ruleDiffs.map((diff) => <RuleDiffRow key={diff.index} diff={diff} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color, marginBottom: '10px' }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {children}
      </div>
    </div>
  )
}

// ─── Tag list ─────────────────────────────────────────────────────────────────

function TagList({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {items.map((item) => (
        <span key={item} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-secondary)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' }}>
          {item}
        </span>
      ))}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function ImportSummaryModal({ summary, onClose }: ImportSummaryModalProps) {
  const { updated, unchanged, notInSheet, notInFile } = summary

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '28px', width: 720, maxWidth: 'calc(100vw - 32px)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '22px', color: 'var(--color-text-primary)', marginBottom: '4px', flexShrink: 0 }}>
          Import Summary
        </h2>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '20px', flexShrink: 0 }}>
          {updated.length} updated · {unchanged} unchanged · {notInSheet.length} ignored · {notInFile.length} untouched
        </p>

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {updated.length > 0 && (
            <Section title={`Updated (${updated.length})`} color="var(--color-text-primary)">
              {updated.map((entry) => <UpdatedRowCard key={entry.header} entry={entry} />)}
            </Section>
          )}
          {unchanged > 0 && (
            <Section title={`Unchanged (${unchanged})`} color="var(--color-text-secondary)">
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                {unchanged} column{unchanged !== 1 ? 's' : ''} matched the import file exactly — no changes applied.
              </p>
            </Section>
          )}
          {notInFile.length > 0 && (
            <Section title={`Not in file — untouched (${notInFile.length})`} color="var(--color-text-secondary)">
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                These sheet columns weren&apos;t in the import file — their mappings were left as-is.
              </p>
              <TagList items={notInFile} />
            </Section>
          )}
          {notInSheet.length > 0 && (
            <Section title={`Not in sheet — ignored (${notInSheet.length})`} color="var(--color-text-secondary)">
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                These headers were in the import file but don&apos;t exist in the current sheet — they were ignored.
              </p>
              <TagList items={notInSheet} />
            </Section>
          )}
          {updated.length === 0 && notInSheet.length === 0 && notInFile.length === 0 && (
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              All columns matched and no changes were needed.
            </p>
          )}
        </div>

        <div style={{ paddingTop: '20px', flexShrink: 0 }}>
          <Button variant="secondary" size="md" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}