"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Event, EventCreate, TimeBlock, TournamentCategory } from "@/lib/api";
import { fmtTime, fmtDateShort } from "@/lib/formatters";
import { Button } from "@/components/ui/Button";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  name:              string;
  category_id:       number | null;
  division:          "B" | "C" | null;
  event_type:        "standard" | "trial";
  building:          string;
  room:              string;
  floor:             string;
  volunteers_needed: number;
  time_block_ids:    number[];
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  mode:               "add" | "edit";
  event?:             Event;
  timeBlocks:         TimeBlock[];
  categories:         TournamentCategory[];
  isReadOnly?:        boolean;
  onSave:             (data: EventCreate) => Promise<void>;
  onCreateCategory:   (name: string) => Promise<TournamentCategory>;
  onClose:            () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyForm(): FormState {
  return {
    name:              "",
    category_id:       null,
    division:          null,
    event_type:        "standard",
    building:          "",
    room:              "",
    floor:             "",
    volunteers_needed: 2,
    time_block_ids:    [],
  };
}

function fromEvent(e: Event): FormState {
  return {
    name:              e.name,
    category_id:       e.category_id,
    division:          e.division,
    event_type:        e.event_type,
    building:          e.building ?? "",
    room:              e.room ?? "",
    floor:             e.floor ?? "",
    volunteers_needed: e.volunteers_needed,
    time_block_ids:    e.time_block_ids,
  };
}

function isDirty(a: FormState, b: FormState): boolean {
  return (
    a.name              !== b.name              ||
    a.category_id       !== b.category_id       ||
    a.division          !== b.division          ||
    a.event_type        !== b.event_type        ||
    a.building          !== b.building          ||
    a.room              !== b.room              ||
    a.floor             !== b.floor             ||
    a.volunteers_needed !== b.volunteers_needed ||
    JSON.stringify(a.time_block_ids.slice().sort()) !==
    JSON.stringify(b.time_block_ids.slice().sort())
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{
      display:     "block",
      fontFamily:  "var(--font-sans)",
      fontSize:    "11px",
      fontWeight:  600,
      color:       "var(--color-text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      marginBottom: "5px",
    }}>
      {children}
      {required && <span style={{ color: "var(--color-danger)", marginLeft: "3px" }}>*</span>}
    </label>
  );
}

const fieldInput: React.CSSProperties = {
  width:        "100%",
  height:       "34px",
  padding:      "0 10px",
  fontFamily:   "var(--font-mono)",
  fontSize:     "13px",
  color:        "var(--color-text-primary)",
  background:   "var(--color-surface)",
  border:       "1px solid var(--color-border)",
  borderRadius: "var(--radius-md)",
  outline:      "none",
  boxSizing:    "border-box",
};

function SegmentedControl({
  value,
  options,
  onChange,
  disabled,
}: {
  value:    string | null;
  options:  { label: string; value: string | null }[];
  onChange: (v: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{
      display:      "inline-flex",
      border:       "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      overflow:     "hidden",
    }}>
      {options.map((opt, idx) => {
        const active  = opt.value === value;
        const isLast  = idx === options.length - 1;
        return (
          <button
            key={String(opt.value)}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            style={{
              fontFamily:  "var(--font-sans)",
              fontSize:    "12px",
              fontWeight:  active ? 600 : 400,
              color:       active ? "var(--color-text-inverse)" : "var(--color-text-secondary)",
              background:  active ? "var(--color-accent)" : "var(--color-surface)",
              border:      "none",
              borderRight: isLast ? "none" : "1px solid var(--color-border)",
              padding:     "5px 14px",
              cursor:      disabled ? "not-allowed" : "pointer",
              transition:  "background var(--transition-fast), color var(--transition-fast)",
              opacity:     disabled ? 0.6 : 1,
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function CategorySelect({
  categories,
  value,
  onChange,
  onCreateCategory,
  disabled,
}: {
  categories:         TournamentCategory[];
  value:              number | null;
  onChange:           (id: number | null) => void;
  onCreateCategory:   (name: string) => Promise<TournamentCategory>;
  disabled?:          boolean;
}) {
  const [creating,     setCreating]     = useState(false);
  const [newName,      setNewName]      = useState("");
  const [saving,       setSaving]       = useState(false);
  const [createError,  setCreateError]  = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) setTimeout(() => createInputRef.current?.focus(), 30);
  }, [creating]);

  const cancelCreate = () => {
    setCreating(false);
    setNewName("");
    setCreateError(null);
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSaving(true);
    setCreateError(null);
    try {
      const cat = await onCreateCategory(trimmed);
      onChange(cat.id);
      cancelCreate();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter")  { e.preventDefault(); handleCreate(); }
    if (e.key === "Escape") { cancelCreate(); }
  };

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display:     "flex",
    alignItems:  "center",
    gap:         "8px",
    width:       "100%",
    padding:     "6px 10px",
    fontFamily:  "var(--font-mono)",
    fontSize:    "13px",
    color:       active ? "var(--color-accent)" : "var(--color-text-primary)",
    background:  active ? "var(--color-accent-subtle)" : "transparent",
    border:      "none",
    borderBottom: "1px solid var(--color-border)",
    cursor:      disabled ? "not-allowed" : "pointer",
    textAlign:   "left",
    opacity:     disabled ? 0.6 : 1,
  });

  const dot = (active: boolean) => (
    <span style={{
      flexShrink:   0,
      width:        "10px",
      height:       "10px",
      borderRadius: "50%",
      border:       `2px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
      background:   active ? "var(--color-accent)" : "transparent",
      display:      "inline-block",
    }} />
  );

  const allOptions = [{ id: null as number | null, name: "— None —" }, ...categories.map(c => ({ id: c.id as number | null, name: c.name }))];

  return (
    <div style={{
      border:       "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      overflow:     "hidden",
    }}>
      {allOptions.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={String(opt.id)}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.id)}
            style={rowStyle(active)}
          >
            {dot(active)}
            {opt.name}
          </button>
        );
      })}

      {/* Add row */}
      {!creating && !disabled && (
        <button
          type="button"
          onClick={() => setCreating(true)}
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        "6px",
            width:      "100%",
            padding:    "6px 10px",
            fontFamily: "var(--font-sans)",
            fontSize:   "12px",
            color:      "var(--color-text-tertiary)",
            background: "transparent",
            border:     "none",
            cursor:     "pointer",
          }}
        >
          <span style={{ fontSize: "14px", lineHeight: 1 }}>+</span>
          New category
        </button>
      )}

      {/* Inline create form */}
      {creating && (
        <div style={{ padding: "8px 10px", borderTop: "1px solid var(--color-border)" }}>
          <input
            ref={createInputRef}
            type="text"
            value={newName}
            placeholder="Category name"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ ...fieldInput, marginBottom: "6px" }}
          />
          {createError && (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-danger)", marginBottom: "6px" }}>
              {createError}
            </p>
          )}
          <div style={{ display: "flex", gap: "6px" }}>
            <Button size="sm" onClick={handleCreate} loading={saving} disabled={!newName.trim()} style={{ flex: 1 }}>
              Add
            </Button>
            <Button size="sm" variant="secondary" onClick={cancelCreate} disabled={saving} style={{ flex: 1 }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function TimeBlockChip({
  block,
  selected,
  onClick,
  disabled,
}: {
  block:    TimeBlock;
  selected: boolean;
  onClick:  () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      style={{
        display:      "inline-flex",
        flexDirection: "column",
        alignItems:   "flex-start",
        padding:      "6px 10px",
        border:       `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-md)",
        background:   selected ? "var(--color-accent)" : "var(--color-surface)",
        cursor:       disabled ? "not-allowed" : "pointer",
        transition:   "background var(--transition-fast), border-color var(--transition-fast)",
        opacity:      disabled ? 0.6 : 1,
        textAlign:    "left",
      }}
    >
      <span style={{
        fontFamily: "var(--font-sans)",
        fontSize:   "12px",
        fontWeight: 600,
        color:      selected ? "var(--color-text-inverse)" : "var(--color-text-primary)",
        lineHeight: 1.3,
      }}>
        {block.label}
      </span>
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize:   "11px",
        color:      selected ? "rgba(255,255,255,0.75)" : "var(--color-text-tertiary)",
        lineHeight: 1.3,
      }}>
        {fmtDateShort(block.date)} · {fmtTime(block.start)}–{fmtTime(block.end)}
      </span>
    </button>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventSidePanel({
  mode,
  event,
  timeBlocks,
  categories,
  isReadOnly = false,
  onSave,
  onCreateCategory,
  onClose,
}: Props) {
  const initial    = mode === "edit" && event ? fromEvent(event) : emptyForm();
  const [form, setForm]           = useState<FormState>(initial);
  const [savedBase, setSavedBase] = useState<FormState>(initial);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Re-sync when the target event changes (e.g. switching between edit targets)
  useEffect(() => {
    const base = mode === "edit" && event ? fromEvent(event) : emptyForm();
    setForm(base);
    setSavedBase(base);
    setError(null);
    setDiscarding(false);
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [event?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = isDirty(form, savedBase);

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const toggleBlock = (id: number) =>
    set("time_block_ids", form.time_block_ids.includes(id)
      ? form.time_block_ids.filter((x) => x !== id)
      : [...form.time_block_ids, id]);

  const handleClose = useCallback(() => {
    if (dirty && !isReadOnly) {
      setDiscarding(true);
    } else {
      onClose();
    }
  }, [dirty, isReadOnly, onClose]);

  // Escape key closes (with guard)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleClose]);

  const handleSave = async (andAdd = false) => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name:              form.name.trim(),
        category_id:       form.category_id,
        division:          form.division,
        event_type:        form.event_type,
        building:          form.building || null,
        room:              form.room || null,
        floor:             form.floor || null,
        volunteers_needed: form.volunteers_needed,
        time_block_ids:    form.time_block_ids,
      });
      if (andAdd) {
        const blank = emptyForm();
        setForm(blank);
        setSavedBase(blank);
        setTimeout(() => nameRef.current?.focus(), 50);
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save event");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const title = isReadOnly
    ? (event?.name ?? "Event")
    : mode === "add" ? "Add event" : "Edit event";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position:   "fixed",
          inset:      0,
          zIndex:     90,
          background: "rgba(0,0,0,0.15)",
        }}
      />

      {/* Panel */}
      <div
        style={{
          position:    "fixed",
          top:         "var(--topbar-height)",
          right:       0,
          width:       "400px",
          height:      "calc(100vh - var(--topbar-height))",
          background:  "var(--color-surface)",
          borderLeft:  "1px solid var(--color-border)",
          boxShadow:   "var(--shadow-lg)",
          zIndex:      100,
          display:     "flex",
          flexDirection: "column",
          overflow:    "hidden",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display:       "flex",
          alignItems:    "center",
          justifyContent: "space-between",
          padding:       "16px 20px",
          borderBottom:  "1px solid var(--color-border)",
          flexShrink:    0,
        }}>
          <h3 style={{
            fontFamily: "var(--font-serif)",
            fontSize:   "18px",
            fontWeight: 400,
            color:      "var(--color-text-primary)",
          }}>
            {title}
          </h3>
          <button
            onClick={handleClose}
            style={{
              display:      "flex",
              alignItems:   "center",
              justifyContent: "center",
              width:        "28px",
              height:       "28px",
              border:       "none",
              background:   "none",
              borderRadius: "var(--radius-sm)",
              cursor:       "pointer",
              color:        "var(--color-text-secondary)",
              fontSize:     "18px",
              lineHeight:   1,
            }}
          >
            ×
          </button>
        </div>

        {/* ── Discard confirmation strip ── */}
        {discarding && (
          <div style={{
            display:        "flex",
            alignItems:     "center",
            justifyContent: "space-between",
            gap:            "10px",
            padding:        "10px 20px",
            background:     "var(--color-warning-subtle)",
            borderBottom:   "1px solid var(--color-warning)",
            flexShrink:     0,
          }}>
            <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)" }}>
              Discard unsaved changes?
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              <Button size="sm" variant="secondary" onClick={() => setDiscarding(false)}>
                Keep editing
              </Button>
              <Button size="sm" variant="danger" onClick={onClose}>
                Discard
              </Button>
            </div>
          </div>
        )}

        {/* ── Scrollable form body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>

          {/* Name */}
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel required>Name</FieldLabel>
            <input
              ref={nameRef}
              type="text"
              value={form.name}
              placeholder="Event name"
              disabled={isReadOnly}
              onChange={(e) => set("name", e.target.value)}
              style={fieldInput}
            />
          </div>

          {/* Category */}
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel>Category</FieldLabel>
            <CategorySelect
              categories={categories}
              value={form.category_id}
              onChange={(id) => set("category_id", id)}
              onCreateCategory={onCreateCategory}
              disabled={isReadOnly}
            />
          </div>

          {/* Division */}
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel>Division</FieldLabel>
            <SegmentedControl
              value={form.division}
              options={[
                { label: "B",  value: "B" },
                { label: "C",  value: "C" },
                { label: "—",  value: null },
              ]}
              onChange={(v) => set("division", v as "B" | "C" | null)}
              disabled={isReadOnly}
            />
          </div>

          {/* Type */}
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel>Type</FieldLabel>
            <SegmentedControl
              value={form.event_type}
              options={[
                { label: "Standard", value: "standard" },
                { label: "Trial",    value: "trial" },
              ]}
              onChange={(v) => set("event_type", v as "standard" | "trial")}
              disabled={isReadOnly}
            />
          </div>

          {/* Location row */}
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel>Location</FieldLabel>
            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: 2 }}>
                <input
                  type="text"
                  value={form.building}
                  placeholder="Building"
                  disabled={isReadOnly}
                  onChange={(e) => set("building", e.target.value)}
                  style={fieldInput}
                />
              </div>
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  value={form.room}
                  placeholder="Room"
                  disabled={isReadOnly}
                  onChange={(e) => set("room", e.target.value)}
                  style={fieldInput}
                />
              </div>
              <div style={{ flex: 1 }}>
                <input
                  type="text"
                  value={form.floor}
                  placeholder="Floor"
                  disabled={isReadOnly}
                  onChange={(e) => set("floor", e.target.value)}
                  style={fieldInput}
                />
              </div>
            </div>
          </div>

          {/* Volunteers needed */}
          <div style={{ marginBottom: "18px" }}>
            <FieldLabel>Volunteers needed</FieldLabel>
            <input
              type="number"
              min={1}
              value={form.volunteers_needed}
              disabled={isReadOnly}
              onChange={(e) => set("volunteers_needed", Math.max(1, Number(e.target.value)))}
              style={{ ...fieldInput, width: "90px" }}
            />
          </div>

          {/* Time blocks */}
          <div style={{ marginBottom: "8px" }}>
            <FieldLabel>Time blocks</FieldLabel>
            {timeBlocks.length === 0 ? (
              <p style={{
                fontFamily: "var(--font-sans)",
                fontSize:   "12px",
                color:      "var(--color-text-tertiary)",
                fontStyle:  "italic",
              }}>
                No time blocks have been created yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "7px" }}>
                {timeBlocks.map((block) => (
                  <TimeBlockChip
                    key={block.id}
                    block={block}
                    selected={form.time_block_ids.includes(block.id)}
                    onClick={() => toggleBlock(block.id)}
                    disabled={isReadOnly}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding:       "14px 20px",
          borderTop:     "1px solid var(--color-border)",
          flexShrink:    0,
          background:    "var(--color-surface)",
        }}>
          {/* API error */}
          {error && (
            <p style={{
              fontFamily:   "var(--font-sans)",
              fontSize:     "12px",
              color:        "var(--color-danger)",
              marginBottom: "10px",
            }}>
              {error}
            </p>
          )}

          {isReadOnly ? (
            <Button variant="secondary" size="sm" onClick={onClose} fullWidth>
              Close
            </Button>
          ) : (
            <div style={{ display: "flex", gap: "8px" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleSave(true)}
                loading={saving}
                disabled={!form.name.trim()}
                style={{ flex: 1 }}
              >
                Save &amp; add another
              </Button>
              <Button
                size="sm"
                onClick={() => handleSave(false)}
                loading={saving}
                disabled={!form.name.trim()}
                style={{ flex: 1 }}
              >
                Save
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
