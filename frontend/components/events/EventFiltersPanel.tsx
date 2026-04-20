"use client";

import { useMemo, useState } from "react";
import { TimeBlock, TournamentCategory } from "@/lib/api";
import { catColorVars } from "@/lib/formatters";
import { Button } from "@/components/ui/Button";

export type EventFilters = {
  search: string;
  categoryIds: number[];
  includeNoCategory: boolean;
  divisions: Array<"B" | "C">;
  includeNoDivision: boolean;
  buildings: string[];
  timeBlockIds: number[];
};

interface Props {
  filters: EventFilters;
  categories: TournamentCategory[];
  buildingOptions: string[];
  timeBlocks: TimeBlock[];
  onApply: (next: EventFilters) => void;
  onClose: () => void;
}

function tagStyle(active: boolean, bg: string, color: string, border: string): React.CSSProperties {
  return {
    height: "28px",
    padding: "0 10px",
    borderRadius: "var(--radius-md)",
    border: `1px solid ${border}`,
    background: active ? bg : "var(--color-surface)",
    color: active ? color : "var(--color-text-secondary)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "var(--font-sans)",
      fontSize: "11px",
      fontWeight: "bold",
      color: "var(--color-text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.04em",
      marginBottom: "8px",
    }}>
      {children}
    </div>
  );
}

function SelectedChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "3px",
      fontFamily: "var(--font-mono)",
      fontSize: "11px",
      color: "var(--color-text-secondary)",
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-sm)",
      padding: "2px 5px",
    }}>
      {label}
      <button
        type="button"
        onClick={onRemove}
        style={{
          display: "flex",
          background: "none",
          border: "none",
          padding: "0 1px",
          cursor: "pointer",
          color: "var(--color-text-tertiary)",
          lineHeight: 1,
          fontSize: "13px",
        }}
      >
        ×
      </button>
    </span>
  );
}

export function EventFiltersPanel({
  filters,
  categories,
  buildingOptions,
  timeBlocks,
  onApply,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<EventFilters>(filters);
  const [buildingQuery, setBuildingQuery] = useState("");
  const [blockQuery, setBlockQuery] = useState("");
  const [buildingOpen, setBuildingOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const triggerClose = () => setIsClosing(true);

  const blockLabelById = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of timeBlocks) map.set(b.id, b.label);
    return map;
  }, [timeBlocks]);

  const buildingSuggestions = useMemo(() => {
    const q = buildingQuery.trim().toLowerCase();
    const selected = new Set(draft.buildings);
    const base = q
      ? buildingOptions.filter((b) => b.toLowerCase().includes(q))
      : buildingOptions;
    return base.filter((b) => !selected.has(b)).slice(0, 8);
  }, [buildingQuery, buildingOptions, draft.buildings]);

  const blockSuggestions = useMemo(() => {
    const q = blockQuery.trim().toLowerCase();
    const selected = new Set(draft.timeBlockIds);
    return timeBlocks
      .filter((b) => !selected.has(b.id))
      .filter((b) => (q ? b.label.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [blockQuery, timeBlocks, draft.timeBlockIds]);

  const addBuilding = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned || draft.buildings.includes(cleaned) || !buildingOptions.includes(cleaned)) return;
    setDraft((d) => ({ ...d, buildings: [...d.buildings, cleaned] }));
    setBuildingQuery("");
  };

  const addBlock = (id: number) => {
    if (draft.timeBlockIds.includes(id)) return;
    setDraft((d) => ({ ...d, timeBlockIds: [...d.timeBlockIds, id] }));
    setBlockQuery("");
  };

  const clearAll = () =>
    setDraft({
      search: draft.search,
      categoryIds: [],
      includeNoCategory: false,
      divisions: [],
      includeNoDivision: false,
      buildings: [],
      timeBlockIds: [],
    });

  const handleApply = () => {
    onApply(draft);
    triggerClose();
  };

  const dropdownList: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 2px)",
    left: 0,
    right: 0,
    zIndex: 10,
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    background: "var(--color-surface)",
    boxShadow: "var(--shadow-md)",
    overflow: "hidden",
    maxHeight: "200px",
    overflowY: "auto",
  };

  const dropdownItem: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    border: "none",
    borderBottom: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    color: "var(--color-text-primary)",
    fontFamily: "var(--font-sans)",
    fontSize: "13px",
    padding: "8px 12px",
    cursor: "pointer",
  };

  const fieldInput: React.CSSProperties = {
    width: "100%",
    height: "34px",
    padding: "0 12px",
    fontFamily: "var(--font-sans)",
    fontSize: "13px",
    background: "var(--color-surface)",
    color: "var(--color-text-primary)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <>
      <style>{`
        @keyframes filterPanelIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes filterPanelOut {
          from { transform: translateX(0); }
          to   { transform: translateX(100%); }
        }
        @keyframes filterFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes filterFadeOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={triggerClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 90,
          background: "rgba(0,0,0,0.15)",
          animation: isClosing
            ? "filterFadeOut 200ms ease-in forwards"
            : "filterFadeIn 180ms ease-out",
        }}
      />

      {/* Panel */}
      <div
        onAnimationEnd={() => { if (isClosing) onClose(); }}
        style={{
          position:      "fixed",
          top:           "var(--topbar-height)",
          right:         0,
          width:         "360px",
          height:        "calc(100vh - var(--topbar-height))",
          background:    "var(--color-surface)",
          borderLeft:    "1px solid var(--color-border)",
          boxShadow:     "var(--shadow-lg)",
          zIndex:        100,
          display:       "flex",
          flexDirection: "column",
          overflow:      "hidden",
          animation:     isClosing
            ? "filterPanelOut 200ms cubic-bezier(0.55, 0, 1, 0.45) forwards"
            : "filterPanelIn 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      >
        {/* Header */}
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          padding:        "16px 20px",
          borderBottom:   "1px solid var(--color-border)",
          flexShrink:     0,
        }}>
          <h3 style={{
            fontFamily: "var(--font-serif)",
            fontSize:   "18px",
            fontWeight: 400,
            color:      "var(--color-text-primary)",
          }}>
            Filters
          </h3>
          <button
            onClick={triggerClose}
            style={{
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              width:          "28px",
              height:         "28px",
              border:         "none",
              background:     "none",
              borderRadius:   "var(--radius-sm)",
              cursor:         "pointer",
              color:          "var(--color-text-secondary)",
              fontSize:       "18px",
              lineHeight:     1,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px", display: "grid", gap: "20px", alignContent: "start" }}>

          {/* Category */}
          <section>
            <SectionLabel>Category</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {categories.map((cat, idx) => {
                const cv = catColorVars(idx);
                const active = draft.categoryIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setDraft((d) => ({
                      ...d,
                      categoryIds: active
                        ? d.categoryIds.filter((id) => id !== cat.id)
                        : [...d.categoryIds, cat.id],
                    }))}
                    style={tagStyle(active, cv.subtle, cv.text, active ? cv.main : "var(--color-border)")}
                  >
                    {cat.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, includeNoCategory: !d.includeNoCategory }))}
                style={tagStyle(
                  draft.includeNoCategory,
                  "var(--color-accent-subtle)",
                  "var(--color-text-primary)",
                  draft.includeNoCategory ? "var(--color-accent)" : "var(--color-border)",
                )}
              >
                No category
              </button>
            </div>
          </section>

          {/* Division */}
          <section>
            <SectionLabel>Division</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {(["B", "C"] as const).map((div) => {
                const active = draft.divisions.includes(div);
                const bg     = `var(--color-div-${div.toLowerCase()}-subtle)`;
                const color  = `var(--color-div-${div.toLowerCase()}-text)`;
                const border = active ? `var(--color-div-${div.toLowerCase()})` : "var(--color-border)";
                return (
                  <button
                    key={div}
                    type="button"
                    onClick={() => setDraft((d) => ({
                      ...d,
                      divisions: active
                        ? d.divisions.filter((x) => x !== div)
                        : [...d.divisions, div],
                    }))}
                    style={tagStyle(active, bg, color, border)}
                  >
                    Division {div}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, includeNoDivision: !d.includeNoDivision }))}
                style={tagStyle(
                  draft.includeNoDivision,
                  "var(--color-accent-subtle)",
                  "var(--color-text-primary)",
                  draft.includeNoDivision ? "var(--color-accent)" : "var(--color-border)",
                )}
              >
                No division
              </button>
            </div>
          </section>

          {/* Building */}
          <section>
            <SectionLabel>Building</SectionLabel>
            {draft.buildings.length > 0 && (
              <div style={{ marginBottom: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {draft.buildings.map((b) => (
                  <SelectedChip
                    key={b}
                    label={b}
                    onRemove={() => setDraft((d) => ({ ...d, buildings: d.buildings.filter((x) => x !== b) }))}
                  />
                ))}
              </div>
            )}
            <div
              style={{ position: "relative" }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setBuildingOpen(false);
                }
              }}
            >
              <input
                type="text"
                value={buildingQuery}
                onChange={(e) => setBuildingQuery(e.target.value)}
                onFocus={() => setBuildingOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (buildingSuggestions.length > 0) addBuilding(buildingSuggestions[0]);
                  }
                  if (e.key === "Escape") setBuildingOpen(false);
                }}
                placeholder="Type or select building..."
                style={fieldInput}
              />
              {buildingOpen && (buildingSuggestions.length > 0 || buildingQuery.trim().length > 0) && (
                <div style={dropdownList}>
                  {buildingSuggestions.length > 0 ? buildingSuggestions.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addBuilding(b)}
                      style={dropdownItem}
                    >
                      {b}
                    </button>
                  )) : (
                    <div style={{ padding: "8px 12px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
                      No results
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Time blocks */}
          <section>
            <SectionLabel>Time blocks</SectionLabel>
            {draft.timeBlockIds.length > 0 && (
              <div style={{ marginBottom: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {draft.timeBlockIds.map((id) => (
                  <SelectedChip
                    key={id}
                    label={blockLabelById.get(id) ?? `#${id}`}
                    onRemove={() => setDraft((d) => ({ ...d, timeBlockIds: d.timeBlockIds.filter((x) => x !== id) }))}
                  />
                ))}
              </div>
            )}
            <div
              style={{ position: "relative" }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setBlockOpen(false);
                }
              }}
            >
              <input
                type="text"
                value={blockQuery}
                onChange={(e) => setBlockQuery(e.target.value)}
                onFocus={() => setBlockOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (blockSuggestions.length > 0) addBlock(blockSuggestions[0].id);
                  }
                  if (e.key === "Escape") setBlockOpen(false);
                }}
                placeholder="Type or select block..."
                style={fieldInput}
              />
              {blockOpen && (blockSuggestions.length > 0 || blockQuery.trim().length > 0) && (
                <div style={dropdownList}>
                  {blockSuggestions.length > 0 ? blockSuggestions.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addBlock(b.id)}
                      style={dropdownItem}
                    >
                      {b.label}
                    </button>
                  )) : (
                    <div style={{ padding: "8px 12px", fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
                      No results
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

        </div>

        {/* Footer */}
        <div style={{
          display:        "flex",
          justifyContent: "space-between",
          alignItems:     "center",
          padding:        "12px 20px",
          borderTop:      "1px solid var(--color-border)",
          flexShrink:     0,
        }}>
          <Button variant="secondary" size="sm" onClick={clearAll}>
            Clear all
          </Button>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="secondary" size="sm" onClick={triggerClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleApply}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
