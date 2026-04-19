"use client";

import { useMemo, useState } from "react";
import { TimeBlock, TournamentCategory } from "@/lib/api";
import { catColorVars } from "@/lib/formatters";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

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
    height: "30px",
    padding: "0 10px",
    borderRadius: "999px",
    border: `1px solid ${border}`,
    background: active ? bg : "var(--color-surface)",
    color: active ? color : "var(--color-text-secondary)",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

function selectedChip(label: string, onRemove: () => void): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 8px", border: "1px solid var(--color-border)", borderRadius: "999px", background: "var(--color-surface)", fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-primary)" }}>
      {label}
      <button type="button" onClick={onRemove} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--color-text-tertiary)", fontSize: "13px", lineHeight: 1 }}>
        x
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
    if (!cleaned) return;
    if (draft.buildings.includes(cleaned)) return;
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

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,0.2)" }} />
      <div style={{ position: "fixed", top: "72px", left: "50%", transform: "translateX(-50%)", zIndex: 130, width: "min(860px, calc(100vw - 28px))", maxHeight: "calc(100vh - 96px)", overflow: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)", background: "var(--color-surface)", boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "20px", fontWeight: 400, color: "var(--color-text-primary)" }}>Filters</h3>
          <button onClick={onClose} style={{ border: "none", background: "none", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: "18px" }}>
            x
          </button>
        </div>

        <div style={{ display: "grid", gap: "18px", padding: "16px" }}>
          <section>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>Category</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {categories.map((cat, idx) => {
                const cv = catColorVars(idx);
                const active = draft.categoryIds.includes(cat.id);
                return (
                  <button key={cat.id} type="button" onClick={() => setDraft((d) => ({ ...d, categoryIds: active ? d.categoryIds.filter((id) => id !== cat.id) : [...d.categoryIds, cat.id] }))} style={tagStyle(active, cv.subtle, cv.text, active ? cv.main : "var(--color-border)")}>
                    {cat.name}
                  </button>
                );
              })}
              <button type="button" onClick={() => setDraft((d) => ({ ...d, includeNoCategory: !d.includeNoCategory }))} style={tagStyle(draft.includeNoCategory, "var(--color-accent-subtle)", "var(--color-text-primary)", draft.includeNoCategory ? "var(--color-accent)" : "var(--color-border)")}>
                No category
              </button>
            </div>
          </section>

          <section>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>Division</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button type="button" onClick={() => setDraft((d) => ({ ...d, divisions: d.divisions.includes("B") ? d.divisions.filter((x) => x !== "B") : [...d.divisions, "B"] }))} style={tagStyle(draft.divisions.includes("B"), "var(--color-div-b-subtle)", "var(--color-div-b-text)", draft.divisions.includes("B") ? "var(--color-div-b)" : "var(--color-border)")}>
                Division B
              </button>
              <button type="button" onClick={() => setDraft((d) => ({ ...d, divisions: d.divisions.includes("C") ? d.divisions.filter((x) => x !== "C") : [...d.divisions, "C"] }))} style={tagStyle(draft.divisions.includes("C"), "var(--color-div-c-subtle)", "var(--color-div-c-text)", draft.divisions.includes("C") ? "var(--color-div-c)" : "var(--color-border)")}>
                Division C
              </button>
              <button type="button" onClick={() => setDraft((d) => ({ ...d, includeNoDivision: !d.includeNoDivision }))} style={tagStyle(draft.includeNoDivision, "var(--color-accent-subtle)", "var(--color-text-primary)", draft.includeNoDivision ? "var(--color-accent)" : "var(--color-border)")}>
                No division
              </button>
            </div>
          </section>

          <section>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>Building</div>
            <Input
              value={buildingQuery}
              onChange={(e) => setBuildingQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (buildingSuggestions.length > 0) addBuilding(buildingSuggestions[0]);
                  else addBuilding(buildingQuery);
                }
              }}
              placeholder="Type building name..."
              fullWidth
              font="mono"
            />
            {buildingSuggestions.length > 0 && (
              <div style={{ marginTop: "6px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                {buildingSuggestions.map((b) => (
                  <button key={b} type="button" onClick={() => addBuilding(b)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)", fontSize: "12px", padding: "8px 10px", cursor: "pointer" }}>
                    {b}
                  </button>
                ))}
              </div>
            )}
            {draft.buildings.length > 0 && (
              <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {draft.buildings.map((b) => (
                  <span key={b}>{selectedChip(b, () => setDraft((d) => ({ ...d, buildings: d.buildings.filter((x) => x !== b) })))}</span>
                ))}
              </div>
            )}
          </section>

          <section>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>Time blocks</div>
            <Input
              value={blockQuery}
              onChange={(e) => setBlockQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (blockSuggestions.length > 0) addBlock(blockSuggestions[0].id);
                }
              }}
              placeholder="Search block label..."
              fullWidth
              font="mono"
            />
            {blockSuggestions.length > 0 && (
              <div style={{ marginTop: "6px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                {blockSuggestions.map((b) => (
                  <button key={b.id} type="button" onClick={() => addBlock(b.id)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)", fontSize: "12px", padding: "8px 10px", cursor: "pointer" }}>
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            {draft.timeBlockIds.length > 0 && (
              <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {draft.timeBlockIds.map((id) => (
                  <span key={id}>
                    {selectedChip(blockLabelById.get(id) ?? `#${id}`, () => setDraft((d) => ({ ...d, timeBlockIds: d.timeBlockIds.filter((x) => x !== id) })))}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--color-border)" }}>
          <Button variant="secondary" size="sm" onClick={clearAll}>
            Clear all
          </Button>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
