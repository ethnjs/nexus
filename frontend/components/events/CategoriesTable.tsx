"use client";

import { useMemo, useState } from "react";
import { Event, TournamentCategory } from "@/lib/api";
import { parseApiError } from "@/lib/errors";
import { Button } from "@/components/ui/Button";
import { IconEdit, IconPlus, IconTrash } from "@/components/ui/Icons";

interface Props {
  categories: TournamentCategory[];
  events: Event[];
  isReadOnly?: boolean;
  onAdd: (name: string) => Promise<void>;
  onEdit: (category: TournamentCategory, name: string) => Promise<void>;
  onDelete: (category: TournamentCategory) => Promise<void>;
}

const thStyle: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "9px 14px",
  textAlign: "left",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace: "nowrap",
  background: "var(--color-surface)",
};

const tdStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "13px",
  color: "var(--color-text-primary)",
  padding: "10px 14px",
  borderBottom: "1px solid var(--color-border)",
  verticalAlign: "middle",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "13px",
  color: "var(--color-text-primary)",
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "var(--radius-sm)",
  padding: "4px 8px",
  outline: "none",
  width: "100%",
};

export function CategoriesTable({
  categories,
  events,
  isReadOnly = false,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  const [showAddRow, setShowAddRow] = useState(false);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usageCount = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of categories) map.set(c.id, 0);
    for (const e of events) {
      if (e.category_id != null) map.set(e.category_id, (map.get(e.category_id) ?? 0) + 1);
    }
    return map;
  }, [categories, events]);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(trimmed);
      setName("");
      setShowAddRow(false);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (category: TournamentCategory) => {
    setSaving(true);
    setError(null);
    try {
      await onDelete(category);
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleEditStart = (category: TournamentCategory) => {
    setShowAddRow(false);
    setError(null);
    setEditingId(category.id);
    setEditName(category.name);
  };

  const handleEditSave = async (category: TournamentCategory) => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === category.name) {
      setEditingId(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onEdit(category, trimmed);
      setEditingId(null);
      setEditName("");
    } catch (e) {
      setError(parseApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "14px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            color: "var(--color-text-secondary)",
          }}
        >
          {categories.length} categor{categories.length === 1 ? "y" : "ies"}
        </span>
        {!isReadOnly && (
          <Button size="sm" onClick={() => { setShowAddRow(true); setError(null); setEditingId(null); }} disabled={showAddRow || saving || editingId !== null}>
            <IconPlus size={12} />
            Add category
          </Button>
        )}
      </div>

      {categories.length === 0 && !showAddRow ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "60px 0",
            border: "1px dashed var(--color-border)",
            borderRadius: "var(--radius-lg)",
            background: "var(--color-surface)",
            textAlign: "center",
            gap: "6px",
          }}
        >
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "18px", color: "var(--color-text-primary)" }}>
            No categories yet
          </p>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
            {isReadOnly ? "No categories are configured." : "Add a category to organize events."}
          </p>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            overflowX: "auto",
            background: "var(--color-surface)",
          }}
        >
          <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: "44%" }}>Name</th>
                <th style={{ ...thStyle, width: "20%" }}>Type</th>
                <th style={{ ...thStyle, width: "18%", textAlign: "center" }}>Events</th>
                {!isReadOnly && <th style={{ ...thStyle, width: "18%", textAlign: "right" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, idx) => {
                const isLast = idx === categories.length - 1 && !showAddRow;
                const inUse = (usageCount.get(cat.id) ?? 0) > 0;
                return (
                  <tr key={cat.id}>
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", fontWeight: 500 }}>
                      {editingId === cat.id ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEditSave(cat);
                            if (e.key === "Escape") { setEditingId(null); setEditName(""); setError(null); }
                          }}
                          style={inputStyle}
                          autoFocus
                        />
                      ) : (
                        cat.name
                      )}
                    </td>
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                      {cat.is_custom ? "Custom" : "Default"}
                    </td>
                    <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", textAlign: "center" }}>
                      {(usageCount.get(cat.id) ?? 0) > 0 ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: "22px",
                            height: "22px",
                            padding: "0 6px",
                            borderRadius: "var(--radius-sm)",
                            background: "var(--color-accent-subtle)",
                            fontFamily: "var(--font-sans)",
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "var(--color-text-primary)",
                          }}
                        >
                          {usageCount.get(cat.id)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-text-tertiary)", fontSize: "12px" }}>-</span>
                      )}
                    </td>
                    {!isReadOnly && (
                      <td style={{ ...tdStyle, borderBottom: isLast ? "none" : "1px solid var(--color-border)", textAlign: "right", whiteSpace: "nowrap" }}>
                        {editingId === cat.id ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => handleEditSave(cat)}
                              loading={saving}
                              disabled={!editName.trim()}
                              style={{ marginRight: "4px" }}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={saving}
                              onClick={() => { setEditingId(null); setEditName(""); setError(null); }}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              title={!cat.is_custom ? "Default categories cannot be edited" : "Edit category"}
                              onClick={() => handleEditStart(cat)}
                              style={{ padding: "0 8px" }}
                              disabled={!cat.is_custom || showAddRow || saving}
                            >
                              <IconEdit size={14} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title={!cat.is_custom ? "Default categories cannot be deleted" : inUse ? "Category in use cannot be deleted" : "Delete category"}
                              onClick={() => handleDelete(cat)}
                              style={{ padding: "0 8px", color: "var(--color-danger)" }}
                              disabled={!cat.is_custom || inUse || showAddRow || saving}
                            >
                              <IconTrash size={14} />
                            </Button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}

              {showAddRow && (
                <tr>
                  <td style={{ ...tdStyle }}>
                    <input
                      type="text"
                      value={name}
                      placeholder="Category name"
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && name.trim()) handleAdd();
                        if (e.key === "Escape") { setShowAddRow(false); setName(""); setError(null); }
                      }}
                      style={inputStyle}
                      autoFocus
                    />
                  </td>
                  <td style={{ ...tdStyle, color: "var(--color-text-secondary)" }}>Custom</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <span style={{ color: "var(--color-text-tertiary)", fontSize: "12px" }}>-</span>
                  </td>
                  {!isReadOnly && (
                    <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                      <Button size="sm" onClick={handleAdd} loading={saving} disabled={!name.trim()} style={{ marginRight: "4px" }}>
                        Save
                      </Button>
                      <Button size="sm" variant="secondary" disabled={saving} onClick={() => { setShowAddRow(false); setName(""); setError(null); }}>
                        Cancel
                      </Button>
                    </td>
                  )}
                </tr>
              )}

              {error && (
                <tr style={{ background: "var(--color-danger-subtle)" }}>
                  <td
                    colSpan={isReadOnly ? 3 : 4}
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: "12px",
                      color: "var(--color-danger)",
                      padding: "6px 14px",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    {error}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
