"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { ChecklistPopover } from "@/components/ui/ChecklistPopover";
import { ChipInput } from "@/components/ui/ChipInput";
import { DatePicker } from "@/components/ui/DatePicker";
import { DivisionButtonGroup } from "@/components/ui/DivisionButtonGroup";
import { Dropdown, type DropdownItem } from "@/components/ui/Dropdown";
import { IconPlus, IconX } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { PillTrigger } from "@/components/ui/PillMenu";
import type { FilterCondition, FilterOp, FilterOptionItem } from "@/lib/api";
import {
  DAY_COUNT_OPS,
  type FilterField,
  isConditionComplete,
  newCondition,
  opLabel,
  RANK_OPS,
  RANK_PREFIX,
  VALUELESS_OPS,
} from "@/lib/filters/model";
import styles from "./FilterBuilderModal.module.css";

// Above this many options a list is faster to type into than to scroll.
const SEARCHABLE_ABOVE = 8;
// Up to this many options fit on one line as buttons.
const BUTTONS_UP_TO = 5;

/** Where a row sits in its list, for the tree line drawn down its lead. */
export type LinePosition = "only" | "first" | "middle" | "last";

export function linePosition(index: number, count: number): LinePosition {
  if (count === 1) return "only";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

/** A row's lead cell: "Where", the join button, or just the tree line. */
export function LeadCell({
  position,
  children,
  style,
}: {
  position: LinePosition;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className={`${styles.lead} ${styles[position]}`} style={style}>
      {children}
    </div>
  );
}

// ─── Width ────────────────────────────────────────────────────────────────
// What a row needs to sit on one line, worked out from what it shows rather
// than measured off the page: the modal sizes itself from this, and a width
// read back from a laid-out row would change as the modal resized around it.
// Mirrors the layout below; text is measured with a canvas.

const GAP = 8;
const FIELD_WIDTH = 200;
const PICKER_WIDTH = 170;
// Chips only: room for a few, so they don't wrap one to a line. Every other
// value control has a size of its own.
const CHIPS_MIN_WIDTH = 240;
const DATE_WIDTH = 170;
// Grip, lead and remove, and the gaps between them and the controls.
const ROW_FRAME = 14 + GAP + 56 + GAP + GAP + 28;

let canvas: HTMLCanvasElement | null = null;

function textWidth(text: string, size: number, weight: number): number {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return text.length * size * 0.6;
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-sans");
  context.font = `${weight} ${size}px ${family || "sans-serif"}`;
  return context.measureText(text).width;
}

function valueWidth(condition: FilterCondition, field: FilterField<never>): number {
  const kind = valueKind(condition.op);
  if (kind === "none") return 0;
  if (kind === "date") return DATE_WIDTH;
  if (kind === "days") return 64 + GAP + 30;
  const options =
    (field.groups
      ? field.groups.find((group) => group.value === condition.group)?.options
      : field.options) ?? [];
  const picked = condition.values.filter((v) => !v.startsWith(RANK_PREFIX));
  const control = field.control ?? (options.length <= BUTTONS_UP_TO ? "buttons" : "chips");
  let width: number;
  if (control === "chips") {
    const labelOf = new Map(options.map((option) => [option.value, option.label]));
    const chips = [...new Set(field.scopes ? picked.map((v) => v.split(":")[0]) : picked)];
    width =
      chips.length === 0
        ? textWidth("Pick values", 12, 400)
        : chips.reduce(
            (sum, chip) =>
              sum +
              textWidth(labelOf.get(chip) ?? chip, 12, 500) +
              35 +
              6 +
              (field.scopes ? 90 : 0),
            0,
          );
    width += 28;
  } else {
    width = options.reduce((sum, option) => sum + textWidth(option.label, 12, 600) + 30 + GAP, 0);
  }
  // The rank: its word, operator and number.
  if (field.rank) width += GAP + 30 + 6 + 92 + 6 + 52;
  return width;
}

function valueMinWidth(condition: FilterCondition, field: FilterField<never> | undefined): number {
  if (!field || valueKind(condition.op) !== "options") return 0;
  const options =
    (field.groups
      ? field.groups.find((group) => group.value === condition.group)?.options
      : field.options) ?? [];
  const control = field.control ?? (options.length <= BUTTONS_UP_TO ? "buttons" : "chips");
  return control === "chips" ? CHIPS_MIN_WIDTH : 0;
}

/** The width a row needs to sit on one line. */
export function rowWidth(
  condition: FilterCondition,
  field: FilterField<never> | undefined,
): number {
  let width = ROW_FRAME + FIELD_WIDTH;
  if (!field) return width;
  if (field.groups && !(field.hideSingleGroup && field.groups.length === 1)) {
    width += GAP + PICKER_WIDTH;
  }
  width +=
    GAP +
    (field.ops.length === 1
      ? textWidth(opLabel(field, field.ops[0], field.single ? 1 : 2), 13, 400) + 8
      : PICKER_WIDTH);
  return width + GAP + Math.max(valueMinWidth(condition, field), valueWidth(condition, field));
}

/** What kind of value an operator takes; switching between kinds clears it. */
function valueKind(op: FilterOp): "none" | "date" | "days" | "options" {
  if (VALUELESS_OPS.has(op)) return "none";
  if (op === "before" || op === "after") return "date";
  if (DAY_COUNT_OPS.has(op)) return "days";
  return "options";
}

/** The field picker's options, under each field's section heading. */
export function fieldPickerItems(fields: FilterField<never>[]): DropdownItem[] {
  const items: DropdownItem[] = [];
  const sections = new Map<string, { value: string; label: string }[]>();
  for (const field of fields) {
    const option = { value: field.key, label: field.label };
    if (!field.section) items.push(option);
    else sections.set(field.section, [...(sections.get(field.section) ?? []), option]);
  }
  for (const [group, options] of sections) items.push({ group, options });
  return items;
}

function toggled(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/**
 * Picked values as chips, with a searchable checklist to add more. Given
 * `scopes`, each chip carries a pill narrowing it to some of them, stored as
 * "{value}:{scope}"; an unnarrowed chip is the bare value.
 */
function ChipValues({
  title,
  options,
  scopes,
  searchable,
  values,
  onChange,
}: {
  title: string;
  options: FilterOptionItem[];
  scopes?: FilterOptionItem[];
  searchable?: boolean;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const labelOf = new Map(options.map((option) => [option.value, option.label]));
  // An option may carry a subtitle (a tournament's owner and dates), to tell
  // apart two that share a name.
  const subtitleOf = (option: FilterOptionItem) =>
    "subtitle" in option && typeof option.subtitle === "string" ? option.subtitle : undefined;
  const byValue = new Map(options.map((option) => [option.value, option]));
  // Only a scoped value splits: an unscoped one may hold a colon of its own
  // (a lunch answer like "Sides: chips").
  const baseOf = (value: string) => (scopes ? value.split(":")[0] : value);
  const chips = [...new Set(values.map(baseOf))];
  const scopesOf = (chip: string) =>
    values.filter((v) => v.startsWith(`${chip}:`)).map((v) => v.split(":")[1]);

  function setScopes(chip: string, picked: string[]) {
    const rest = values.filter((v) => baseOf(v) !== chip);
    onChange([...rest, ...(picked.length > 0 ? picked.map((s) => `${chip}:${s}`) : [chip])]);
  }

  return (
    <ChipInput
      value={chips}
      getChipLabel={(chip) => labelOf.get(chip) ?? chip}
      getChipTooltip={(chip) => {
        const option = byValue.get(chip);
        return option && subtitleOf(option);
      }}
      onChange={(kept) => onChange(values.filter((v) => kept.includes(baseOf(v))))}
      variant="transparent"
      size="sm"
      disableInput
      fullWidth
      emptyLabel="Pick values"
      renderChipTrailing={
        scopes
          ? (chip) => {
              const picked = scopesOf(chip);
              const label =
                picked.length === 0
                  ? "Any track"
                  : picked.length === 1
                    ? (scopes.find((s) => s.value === picked[0])?.label ?? picked[0])
                    : `${picked.length} tracks`;
              return (
                <ChecklistPopover
                  trigger={(open) => <PillTrigger label={label} open={open} />}
                  items={scopes}
                  getKey={(scope) => scope.value}
                  renderLabel={(scope) => scope.label}
                  getSearchText={(scope) => scope.label}
                  isSelected={(scope) => picked.includes(scope.value)}
                  onToggle={(scope) => setScopes(chip, toggled(picked, scope.value))}
                  width={240}
                  align="left"
                />
              );
            }
          : undefined
      }
      addButton={
        <ChecklistPopover
          trigger={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              iconOnly
              title={`Pick ${title.toLowerCase()}`}
              style={{ padding: 0, flexShrink: 0 }}
            >
              <IconPlus size={13} />
            </Button>
          }
          items={options}
          getKey={(option) => option.value}
          renderLabel={(option) => option.label}
          getSubtitle={subtitleOf}
          getSearchText={(option) => `${option.label} ${subtitleOf(option) ?? ""}`}
          searchable={searchable ?? options.length > SEARCHABLE_ABOVE}
          isSelected={(option) => chips.includes(option.value)}
          onToggle={(option) =>
            onChange(
              chips.includes(option.value)
                ? values.filter((v) => baseOf(v) !== option.value)
                : [...values, option.value],
            )
          }
          emptyMessage="Nothing to filter by"
          width={300}
          align="left"
        />
      }
    />
  );
}

/** Event preferences' rank condition: an operator and a number, or none. */
function RankControl({
  value,
  variant,
  onChange,
}: {
  value: string | undefined;
  variant: "primary" | "secondary";
  onChange: (value: string | null) => void;
}) {
  const [op = "", n = ""] = value ? value.slice(RANK_PREFIX.length).split(":") : [];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
      <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>rank</span>
      <div style={{ width: "92px" }}>
        <Dropdown
          variant={variant}
          size="sm"
          fullWidth
          options={[{ value: "", label: "any" }, ...RANK_OPS]}
          value={op}
          onChange={(next) => onChange(next ? `${RANK_PREFIX}${next}:${n || "1"}` : null)}
        />
      </div>
      {op && (
        <div style={{ width: "52px" }}>
          <Input
            variant={variant}
            aria-label="Rank"
            size="sm"
            font="sans"
            charset="numeric"
            fullWidth
            value={n}
            onChange={(e) => onChange(`${RANK_PREFIX}${op}:${e.target.value}`)}
          />
        </div>
      )}
    </div>
  );
}

interface FilterConditionRowProps {
  condition: FilterCondition;
  field: FilterField<never> | undefined;
  fieldItems: DropdownItem[];
  fieldByKey: Map<string, FilterField<never>>;
  /** "Where" or the join button; nothing on later rows, which the line joins. */
  lead: ReactNode;
  position: LinePosition;
  /** The drag grip, from the sortable list around the row. */
  handle?: ReactNode;
  /** Shown once Apply has been pressed with this row unfinished. */
  error?: string | null;
  /** "secondary" (white) inside a group, whose box is the page colour. */
  variant?: "primary" | "secondary";
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
}

/** One filter row: field, group (paired fields), operator, value, remove. */
export function FilterConditionRow({
  condition,
  field,
  fieldItems,
  fieldByKey,
  lead,
  position,
  handle,
  error,
  variant = "primary",
  onChange,
  onRemove,
}: FilterConditionRowProps) {
  const options =
    (field?.groups
      ? field.groups.find((group) => group.value === condition.group)?.options
      : field?.options) ?? [];

  // Whether the value has wrapped below the field: it's then indented under
  // an elbow, so it reads as part of this row rather than a row of its own.
  const controlsRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => {
    const controls = controlsRef.current;
    const valueBox = valueRef.current;
    const first = controls?.firstElementChild;
    if (!controls || !valueBox || !(first instanceof HTMLElement)) return;
    // Below the field's bottom edge, not merely lower: a short or empty value
    // is centred on the first line, so its top sits lower than the field's.
    const check = () => setWrapped(valueBox.offsetTop >= first.offsetTop + first.offsetHeight);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(controls);
    return () => observer.disconnect();
  }, []);

  function setOp(op: FilterOp) {
    const keep = valueKind(op) === valueKind(condition.op);
    onChange({ ...condition, op, values: keep ? condition.values : [] });
  }

  const setValues = (values: string[]) => onChange({ ...condition, values });

  // Backspace or Delete on a row that filters nothing yet removes it, so a
  // row added by mistake goes without reaching for the mouse.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    if (!(e.target instanceof HTMLButtonElement)) return;
    if (isConditionComplete(condition, field)) return;
    e.preventDefault();
    onRemove();
  }

  let value: ReactNode = null;
  const kind = valueKind(condition.op);
  if (field?.groups && !condition.group && kind === "options") {
    value = (
      <span style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>
        Pick {(field.groupLabel ?? "which one").toLowerCase()} first
      </span>
    );
  } else if (field && kind === "date") {
    value = (
      <div style={{ width: `${DATE_WIDTH}px` }}>
        <DatePicker
          variant={variant}
          size="sm"
          fullWidth
          aria-label="Date"
          value={condition.values[0] ?? ""}
          onChange={(date) => setValues(date ? [date] : [])}
        />
      </div>
    );
  } else if (field && kind === "days") {
    value = (
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ width: "64px" }}>
          <Input
            variant={variant}
            aria-label="Days"
            size="sm"
            font="sans"
            charset="numeric"
            placeholder="30"
            fullWidth
            value={condition.values[0] ?? ""}
            onChange={(e) => setValues(e.target.value ? [e.target.value] : [])}
          />
        </div>
        <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>days</span>
      </div>
    );
  } else if (field && kind === "options") {
    const control = field.control ?? (options.length <= BUTTONS_UP_TO ? "buttons" : "chips");
    // The rank condition is stored among the values but edited on its own.
    const rank = condition.values.find((v) => v.startsWith(RANK_PREFIX));
    const picked = condition.values.filter((v) => !v.startsWith(RANK_PREFIX));
    const withRank = (next: string[]) => setValues(rank ? [...next, rank] : next);
    let picker: ReactNode;
    if (control === "chips") {
      picker = (
        <ChipValues
          title={field.label}
          options={options}
          scopes={field.scopes}
          searchable={field.searchable}
          values={picked}
          onChange={withRank}
        />
      );
    } else {
      const Group = control === "divisions" ? DivisionButtonGroup : ButtonGroup;
      picker = (
        <Group
          size="sm"
          options={options}
          value={picked}
          onChange={(v) => withRank(field.single ? [v] : toggled(picked, v))}
        />
      );
    }
    value = field.rank ? (
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>{picker}</div>
        <RankControl
          value={rank}
          variant={variant}
          onChange={(next) => setValues(next ? [...picked, next] : picked)}
        />
      </div>
    ) : (
      picker
    );
  }

  return (
    // Grip, lead and remove keep to the first line; the controls between
    // them wrap, so a long value drops under the field rather than squeezing.
    <div
      onKeyDown={onKeyDown}
      className={styles.row}
      style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}
    >
      <div
        className={styles.reveal}
        style={{
          width: "14px",
          height: "28px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
        }}
      >
        {handle}
      </div>
      <LeadCell position={position}>{lead}</LeadCell>
      <div
        ref={controlsRef}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <div style={{ width: "200px", flexShrink: 0 }}>
          <Dropdown
            variant={variant}
            size="sm"
            fullWidth
            searchable
            placeholder="Field"
            options={fieldItems}
            value={condition.field}
            onChange={(key) => {
              const next = fieldByKey.get(key);
              if (next) onChange(newCondition(next));
            }}
          />
        </div>
        {field?.groups && !(field.hideSingleGroup && field.groups.length === 1) && (
          <div style={{ width: "170px", flexShrink: 0 }}>
            <Dropdown
              variant={variant}
              size="sm"
              fullWidth
              locked={field.groups.length === 1}
              searchable={field.groups.length > SEARCHABLE_ABOVE}
              placeholder={field.groupLabel ?? "Which one"}
              options={field.groups.map((group) => ({ value: group.value, label: group.label }))}
              value={condition.group ?? ""}
              onChange={(group) => onChange({ ...condition, group, values: [] })}
            />
          </div>
        )}
        {/* One operator is nothing to choose: it reads as text ("is"). */}
        {field && field.ops.length === 1 && (
          <span
            style={{
              flexShrink: 0,
              padding: "0 4px",
              fontSize: "13px",
              color: "var(--color-text-secondary)",
            }}
          >
            {opLabel(field, field.ops[0], field.single ? 1 : 2)}
          </span>
        )}
        {field && field.ops.length > 1 && (
          <div style={{ width: "170px", flexShrink: 0 }}>
            <Dropdown
              variant={variant}
              size="sm"
              fullWidth
              options={field.ops.map((op) => ({
                value: op,
                label: opLabel(field, op, field.single ? 1 : 2),
              }))}
              value={condition.op}
              onChange={(op) => setOp(op as FilterOp)}
            />
          </div>
        )}
        <div
          ref={valueRef}
          className={wrapped && value ? styles.subline : undefined}
          style={{ flex: "1 1 auto", minWidth: `${valueMinWidth(condition, field)}px` }}
        >
          <div className={wrapped && value ? styles.sublineContent : undefined}>{value}</div>
        </div>
        {error && (
          <div
            role="alert"
            style={{ flexBasis: "100%", fontSize: "12px", color: "var(--color-danger)" }}
          >
            {error}
          </div>
        )}
      </div>
      {/* Wrapped: Button sets its own opacity inline, which the hover rule
          can't override. */}
      <span className={styles.reveal} style={{ display: "inline-flex" }}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          title="Remove filter"
          aria-label="Remove filter"
          onClick={onRemove}
        >
          <IconX size={14} />
        </Button>
      </span>
    </div>
  );
}
