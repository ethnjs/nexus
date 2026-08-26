'use client'

import { FormFieldOption, FormFieldConfig, FormQuestionType, ResolvedShiftOption, Tournament, TournamentShift } from '@/lib/api'
import { formatTime } from '@/lib/timeFormat'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Checkbox } from '@/components/ui/Checkbox'
import { Dropdown } from '@/components/ui/Dropdown'
import { ButtonGroup } from '@/components/ui/ButtonGroup'
import { Toggle } from '@/components/ui/Toggle'
import { RankedList } from '@/components/ui/RankedList'
import { RadioList } from '@/components/ui/RadioList'
import { CheckboxList } from '@/components/ui/CheckboxList'
import { OptionsEditor, EditableOption, BranchTarget } from '@/components/forms/OptionsEditor'
import { EntityOptionsEditor } from '@/components/forms/EntityOptionsEditor'
import { activePresetKind, isEntityBackedPreset } from '@/lib/forms/fieldKeyPresets'
import { OPTION_BEARING_TYPES, BRANCHING_TYPES } from '@/lib/forms/fieldTypes'

// Only what rendering actually needs — not the full persisted FormField
// (id, form_id, timestamps, ...), so an in-progress/unsaved draft field in
// the builder (no id yet) can be rendered without a fake id to satisfy the type.
// field_key is optional and only consulted by edit mode (reserved presets —
// availability/event_preference/lunch — key off it); view mode never reads it.
export interface QuestionFieldData {
  label: string
  description: string | null
  question_type: FormQuestionType
  config: FormFieldConfig | null
  field_key?: string
}

type FieldUpdate = Partial<QuestionFieldData>

interface QuestionRendererProps {
  field: QuestionFieldData
  /** 'view' (default) = respondent-facing rendering, either a live answer widget
      (interactive) or a read-only preview. 'edit' = the TD-facing config editor
      for this question_type's body (options list, ranks, confirm text, ...). */
  mode?: 'view' | 'edit'
  /** view mode only. false = read-only preview (the builder's collapsed card
      state); true = a real respondent can answer. */
  interactive?: boolean
  /** view mode only. Shape depends on question_type (string for text types,
      boolean for acknowledgment, ...). */
  value?: unknown
  onChange?: (value: unknown) => void
  /** view mode, interactive only — validation message for this field, shown
      inline where the question type has somewhere to put it (currently just
      ranked_choice's add-combobox; other types don't have an equivalent
      inline slot yet, so the caller still has to render its own message for
      them). Not used at all in edit mode — see the `errors` prop instead. */
  error?: string
  /** view mode only — the tournament's shifts, so an availability option's
      time range can resolve even when `value` is still the raw shift-id
      list (the builder's collapsed card preview) rather than GET's already-
      resolved shape. null/undefined = no range shown for the raw-id case
      (an already-resolved `value` still renders its range regardless). */
  shifts?: TournamentShift[] | null
  /** Hide the label/description header — e.g. the builder's expanded card already
      shows the label via its own editable Input, so repeating it here would be
      redundant. */
  showHeader?: boolean
  /** edit mode only — applies a partial update to the field being edited. */
  onFieldChange?: (updates: FieldUpdate) => void
  /** edit mode only — tournament scope for the availability/event_preference
      presets' entity-backed options (id + is_multi_day, used by
      EntityOptionsEditor). null/undefined hides those presets' editor
      (falls through to the plain preview instead). */
  tournament?: Tournament | null
  /** edit mode only — candidate "jump to" fields for single_select_radio/dropdown's
      per-option branching. Omitted (or empty) hides the branch dropdown. */
  branchTargets?: BranchTarget[]
  /** edit mode only — whether branching is currently toggled on for this field
      (the toggle itself lives outside QuestionRenderer, in FieldToolbar). */
  branchingEnabled?: boolean
  /** edit mode only — whether this field's options currently show a separate
      value input (freeform types only — entity-backed presets ignore this,
      their value is always the picked entity ids). Toggle lives in
      FieldToolbar, same as branchingEnabled. */
  customValuesEnabled?: boolean
  /** edit mode only — this field's useFormValidation messages (label/key
      errors are handled by the caller — see FieldCard — so only the
      body-relevant ones need to reach here: confirmation text, options,
      ranks). Each body works out for itself which of its own inputs a given
      message belongs to, rather than the message carrying that routing. */
  errors?: string[]
}

// Shared between the builder's field-card preview/editor (mode='view'/'edit')
// and the eventual /preview and /view pages (mode='view', interactive=true) —
// one place that knows how each question_type both answers and edits, so the
// builder's editor and a respondent's view never drift apart. Reserved-key
// entity grouping (availability/event_preference) mostly doesn't affect view
// mode — it only ever reads an option's `label`, not its raw `value` — except
// availability, where GET /forms/{id}/ resolves `value` into each grouped
// shift's own start/end (see optionDisplayLabel) so the option can show its
// time range alongside the TD-typed label.
export function QuestionRenderer({
  field, mode = 'view', interactive = false, value, onChange, error, shifts, showHeader = true,
  onFieldChange, tournament, branchTargets, branchingEnabled, customValuesEnabled, errors = [],
}: QuestionRendererProps) {
  const config = field.config ?? {}

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {showHeader && (
        <div>
          {/* data-focus marks which editor input a click here corresponds to,
              so the builder's collapsed card can open straight into it. Inert
              everywhere else. */}
          <span data-focus="label" style={{ fontFamily: 'var(--font-sans)', fontSize: '18px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {field.label || 'Untitled question'}
            {config.required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
          </span>
          {field.description && (
            <p data-focus="description" style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
              {field.description}
            </p>
          )}
        </div>
      )}

      {mode === 'edit' ? (
        <QuestionEditBody
          field={field}
          onFieldChange={onFieldChange ?? (() => {})}
          tournament={tournament ?? null}
          branchTargets={branchTargets}
          branchingEnabled={branchingEnabled}
          customValuesEnabled={customValuesEnabled}
          errors={errors}
        />
      ) : (
        <QuestionBody field={field} interactive={interactive} value={value} onChange={onChange} error={error} shifts={shifts} />
      )}
    </div>
  )
}

// number[] (unresolved, still-editing shape) elements are numbers;
// ResolvedShiftOption[] (GET-resolved, respondent-facing shape) elements are
// objects. ResolvedEventOption[] is also an array of objects but has no
// start/end, so checking for 'start' is what actually distinguishes the two
// resolved shapes (event_preference options must never hit timeRangeOf).
function isResolvedShiftOptions(value: FormFieldOption['value']): value is ResolvedShiftOption[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && 'start' in value[0]
}

function isRawShiftIds(value: FormFieldOption['value']): value is number[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === 'number'
}

function timeRangeOf(starts: string[], ends: string[]): string {
  // ISO strings compare lexicographically the same as chronologically here
  // since they're all the same backend format/timezone, so plain string
  // min/max works without parsing dates.
  const start = starts.reduce((min, s) => (s < min ? s : min))
  const end = ends.reduce((max, e) => (e > max ? e : max))
  return `${formatTime(start)}–${formatTime(end)}`
}

// availability's option label alone doesn't tell a respondent when it
// actually is — this appends the span across every shift grouped under the
// option (min start to max end, not one shift's own range) so "All Day"
// reads as "All Day (7:00 AM–5:00 PM)" instead of leaving them to guess or
// hunt down each shift individually. Handles both shapes `value` can be in
// here: GET's already-resolved `{id, label, start, end}[]`, and the raw
// shift-id list the builder's collapsed card preview still has — the latter
// needs `shifts` (looked up by id) to find each one's start/end itself.
function optionDisplayLabel(option: FormFieldOption, shifts?: TournamentShift[] | null): string {
  if (isResolvedShiftOptions(option.value)) {
    const resolved = option.value
    return `${option.label} (${timeRangeOf(resolved.map((s) => s.start), resolved.map((s) => s.end))})`
  }
  if (isRawShiftIds(option.value) && shifts) {
    const matched = shifts.filter((s) => (option.value as number[]).includes(s.id))
    if (matched.length > 0) {
      return `${option.label} (${timeRangeOf(matched.map((s) => s.start), matched.map((s) => s.end))})`
    }
  }
  return option.label
}

function QuestionBody({ field, interactive, value, onChange, error, shifts }: {
  field: QuestionFieldData
  interactive?: boolean
  value?: unknown
  onChange?: (value: unknown) => void
  error?: string
  shifts?: TournamentShift[] | null
}) {
  const config = field.config ?? {}

  switch (field.question_type) {
    case 'short_text':
      return (
        <Input
          value={interactive ? (value as string | undefined) ?? '' : ''}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={interactive ? undefined : 'Short answer'}
          locked={!interactive}
          fullWidth
        />
      )

    case 'long_text':
      return (
        <Textarea
          value={interactive ? (value as string | undefined) ?? '' : ''}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={interactive ? undefined : 'Long answer'}
          disabled={!interactive}
          rows={3}
          fullWidth
        />
      )

    case 'acknowledgment':
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: interactive ? 'pointer' : 'default' }}>
          <Checkbox
            checked={interactive ? Boolean(value) : false}
            onChange={(checked) => onChange?.(checked)}
            locked={!interactive}
            size={18}
          />
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--color-text-secondary)' }}>
            {config.confirm_label || 'I understand'}
          </span>
        </label>
      )

    case 'single_select_radio': {
      const options: FormFieldOption[] = config.options ?? []
      const displayOptions = options.map((opt) => ({ value: opt.option_id, label: optionDisplayLabel(opt, shifts) }))
      const selected = interactive ? (value as string | undefined) ?? '' : ''

      if (config.display_style === 'buttons') {
        return (
          <ButtonGroup
            options={displayOptions}
            value={selected}
            onChange={(v) => interactive && onChange?.(v)}
            locked={!interactive}
            clickThrough={!interactive}
          />
        )
      }

      return (
        <RadioList
          options={displayOptions}
          value={selected}
          onChange={(v) => interactive && onChange?.(v)}
          locked={!interactive}
          size={19}
          fontSize="16px"
          gap="8px"
        />
      )
    }

    case 'single_select_dropdown': {
      const options: FormFieldOption[] = config.options ?? []
      return (
        <Dropdown
          value={interactive ? (value as string | undefined) ?? '' : ''}
          onChange={(v) => onChange?.(v)}
          options={options.map((opt) => ({ value: opt.option_id, label: opt.label }))}
          placeholder="Choose"
          locked={!interactive}
          fullWidth
        />
      )
    }

    case 'multi_select_checkbox': {
      const options: FormFieldOption[] = config.options ?? []
      const displayOptions = options.map((opt) => ({ value: opt.option_id, label: optionDisplayLabel(opt, shifts) }))
      const selected = interactive ? ((value as string[] | undefined) ?? []) : []

      function toggle(optionId: string) {
        if (!interactive) return
        onChange?.(selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId])
      }

      if (config.display_style === 'buttons') {
        return (
          <ButtonGroup
            options={displayOptions}
            value={selected}
            onChange={toggle}
            locked={!interactive}
            clickThrough={!interactive}
          />
        )
      }

      return (
        <CheckboxList
          options={displayOptions}
          value={selected}
          onChange={toggle}
          locked={!interactive}
          size={19}
          fontSize="16px"
          gap="8px"
        />
      )
    }

    case 'ranked_choice': {
      const options: FormFieldOption[] = config.options ?? []
      const ranks = config.ranks ?? options.length
      return (
        <RankedList
          options={options.map((opt) => ({ value: opt.option_id, label: opt.label }))}
          ranks={ranks}
          value={interactive ? (value as Record<string, string> | undefined) ?? {} : {}}
          onChange={(next) => interactive && onChange?.(next)}
          allowDuplicates={!!config.allow_duplicates}
          locked={!interactive}
          error={error}
        />
      )
    }

    default:
      // reserved lunch_* config bodies (date + category picker) — not wired up yet.
      return (
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
          Preview not available for &ldquo;{field.question_type}&rdquo; yet.
        </p>
      )
  }
}

// The TD-facing counterpart to QuestionBody — same question_type switch, but
// each branch renders that type's config editor instead of an answer widget.
// Reserved presets override the plain option-bearing-type editor only when
// they're entity-backed (availability/event_preference, real tournament
// data via EntityOptionsEditor) — lunch's options are freeform food choices,
// so it shares the same OptionsEditor as any other select/checkbox field
// (its date+category key derivation lives in PresetPopover, not here).
// Branching/display_style support is purely a question_type property
// (BRANCHING_TYPES/DISPLAY_STYLE_TYPES), not tied to whether the options
// happen to be entity-backed — an availability field is still real,
// addressable rows a TD can jump from or lay out as buttons, same as any
// other single_select_radio/dropdown field.
function QuestionEditBody({ field, onFieldChange, tournament, branchTargets, branchingEnabled, customValuesEnabled, errors = [] }: {
  field: QuestionFieldData
  onFieldChange: (updates: FieldUpdate) => void
  tournament: Tournament | null
  branchTargets?: BranchTarget[]
  branchingEnabled?: boolean
  customValuesEnabled?: boolean
  errors?: string[]
}) {
  const presetKind = activePresetKind(field.field_key ?? '')
  const supportsBranching = BRANCHING_TYPES.includes(field.question_type)
  const isEntityBackedKind = isEntityBackedPreset(presetKind)
  const hasTrackOutcomes = presetKind === 'track_status' || (presetKind === 'availability' && !!field.config?.track_status_enabled)
  // tournament null means the entity-backed editor has no scope to fetch
  // shifts/events from — falls through to the read-only preview at the
  // bottom instead (see the tournament prop doc on QuestionRenderer), never
  // the plain freeform OptionsEditor: an availability/event_preference
  // field's options are never TD-typed text, tournament or not.
  const isEntity = isEntityBackedKind && !!tournament

  if (!isEntityBackedKind && field.question_type === 'acknowledgment') {
    // Gated on the current config too, not just the errors snapshot from the
    // last Save attempt — otherwise typing into the field wouldn't clear its
    // own error until the next Save/validate() call re-ran.
    const confirmError = errors.includes('Confirmation text is required.') && !field.config?.confirm_label?.trim()
      ? 'Confirmation text is required.' : undefined
    return <AcknowledgmentBody field={field} onFieldChange={onFieldChange} error={confirmError} />
  }

  const usesTrackOutcomeEditor = hasTrackOutcomes && !!tournament

  if (isEntity || usesTrackOutcomeEditor || (!isEntityBackedKind && OPTION_BEARING_TYPES.includes(field.question_type))) {
    return (
      <>
        {isEntity || usesTrackOutcomeEditor ? (
          <EntityOptionsEditor
            fieldKey={presetKind as 'availability' | 'event_preference' | 'track_status'}
            tournament={tournament!}
            questionType={field.question_type}
            options={(field.config?.options as EditableOption[] | undefined) ?? []}
            onChange={(options) => onFieldChange({ config: { ...field.config, options } })}
            displayStyle={field.config?.display_style}
            branchTargets={supportsBranching && branchingEnabled ? branchTargets : undefined}
            errors={errors}
            trackStatusEnabled={hasTrackOutcomes}
          />
        ) : (
          <OptionsEditor
            options={(field.config?.options as EditableOption[] | undefined) ?? []}
            onChange={(options) => onFieldChange({ config: { ...field.config, options } })}
            questionType={field.question_type}
            displayStyle={field.config?.display_style}
            branchTargets={supportsBranching && branchingEnabled ? branchTargets : undefined}
            syncValueWithLabel={!customValuesEnabled}
            errors={errors}
          />
        )}
        {/* Ranks/duplicates apply to ranked_choice regardless of whether its
            options are entity-backed (event_preference) or freeform — the
            rank mechanics are a property of the question type, not of where
            the option rows come from. */}
        {field.question_type === 'ranked_choice' && (() => {
          const options = (field.config?.options as EditableOption[] | undefined) ?? []
          const ranks = field.config?.ranks ?? 1
          // Same live-data gate as confirmError above — re-check against the
          // current option count rather than trusting the errors snapshot is
          // still accurate once ranks or the option list has since changed.
          const ranksError = errors.includes("Ranks can't exceed the number of options.") && ranks > options.length
            ? "Can't exceed the number of options." : undefined
          return (
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'flex-end', gap: '20px' }}>
            <div style={{ width: '100px' }}>
              <Input
                label="Ranks"
                type="number"
                min={1}
                value={String(ranks)}
                onChange={(e) => onFieldChange({ config: { ...field.config, ranks: Math.max(1, Number(e.target.value) || 1) } })}
                error={ranksError}
                size="sm"
                fullWidth
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '9px' }}>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                Allow duplicate ranks
              </span>
              <Toggle
                checked={!!field.config?.allow_duplicates}
                onChange={(checked) => onFieldChange({ config: { ...field.config, allow_duplicates: checked } })}
              />
            </div>
          </div>
          )
        })()}
      </>
    )
  }

  return <QuestionBody field={field} interactive={false} />
}

// Acknowledgment's edit body — the one piece of its config with no default
// on the backend (AcknowledgmentConfig.confirm_label has no fallback, unlike
// every other type-specific config key here), so it needs a real editor
// rather than silently defaulting at save time like ranks/allow_duplicates.
function AcknowledgmentBody({ field, onFieldChange, error }: {
  field: QuestionFieldData
  onFieldChange: (updates: FieldUpdate) => void
  error?: string
}) {
  return (
    <Input
      label="Confirmation text"
      value={field.config?.confirm_label ?? ''}
      onChange={(e) => onFieldChange({ config: { ...field.config, confirm_label: e.target.value } })}
      placeholder="I understand and agree to the above"
      error={error}
      size="sm"
      fullWidth
    />
  )
}
