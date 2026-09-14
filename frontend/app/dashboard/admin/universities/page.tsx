"use client";

import { useEffect, useMemo, useState } from "react";
import { universitiesApi, University, ApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { EditableText } from "@/components/ui/EditableText";
import { BulkDeleteModal } from "@/components/ui/BulkDeleteModal";
import { NewUniversityModal } from "@/components/admin/NewUniversityModal";
import { IconSearch, IconSchool, IconTrash, IconPlus } from "@/components/ui/Icons";
import { useActionToast } from "@/lib/useActionToast";
import table from "@/components/ui/Table.module.css";

const COLUMNS = [
  "minmax(260px, 2fr)",   // name
  "minmax(120px, 0.7fr)", // abbreviation
  "minmax(180px, 1.2fr)", // location
  "44px",                 // actions — one icon button
].join(" ");

const MIN_TABLE_WIDTH = 664;

const CELL_TEXT: React.CSSProperties = {
  fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 400,
};

function UniversityRow({ university, onSave, onDelete }: {
  university: University;
  /** Rejects with the server's message, which EditableText shows under the field. */
  onSave: (patch: { name?: string; abbreviation?: string | null; location?: string | null }) => Promise<void>;
  onDelete: () => void;
}) {
  return (
    <div className={table.row}>
      {/* Name is required, so it can't be cleared — leaving the field empty
          abandons the edit rather than blanking the record. */}
      <EditableText
        value={university.name}
        textStyle={{ ...CELL_TEXT, fontWeight: 500 }}
        title="Click to rename"
        onSave={(name) => onSave({ name })}
      />

      {/* Both optional, so both take allowEmpty — otherwise a wrong
          abbreviation could never be removed — and a placeholder, or an empty
          cell would leave nothing to click. */}
      <EditableText
        value={university.abbreviation ?? ""}
        placeholder="Add"
        allowEmpty
        textStyle={CELL_TEXT}
        title="Click to edit abbreviation"
        onSave={(abbreviation) => onSave({ abbreviation: abbreviation || null })}
      />

      <EditableText
        value={university.location ?? ""}
        placeholder="Add"
        allowEmpty
        textStyle={CELL_TEXT}
        title="Click to edit location"
        onSave={(location) => onSave({ location: location || null })}
      />

      <div style={{ display: "flex", justifyContent: "center" }}>
        <Button
          type="button" variant="secondary" size="sm" iconOnly
          title="Delete university" onClick={onDelete}
        >
          <IconTrash size={13} style={{ color: "var(--color-danger)" }} />
        </Button>
      </div>
    </div>
  );
}

export default function AdminUniversitiesPage() {
  const run = useActionToast();
  const [universities, setUniversities] = useState<University[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<University | null>(null);

  useEffect(() => {
    universitiesApi.list()
      .then(setUniversities)
      .catch((err: unknown) => {
        setUniversities([]);
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load universities.");
      });
  }, []);

  const visible = useMemo(() => {
    const rows = universities ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((u) =>
      u.name.toLowerCase().includes(query) ||
      (u.abbreviation?.toLowerCase().includes(query) ?? false) ||
      (u.location?.toLowerCase().includes(query) ?? false)
    );
  }, [universities, search]);

  /** Rethrows so EditableText keeps the field open with the server's message. */
  async function handleSave(id: number, patch: Parameters<typeof universitiesApi.update>[1]) {
    await run("University updated", async () => {
      const updated = await universitiesApi.update(id, patch);
      setUniversities((prev) => (prev ?? []).map((u) => (u.id === id ? updated : u)));
    });
  }

  function handleCreated(created: University) {
    // Inserted in name order rather than appended — the list is sorted by name
    // server-side, and a new row landing at the bottom looks like it failed.
    setUniversities((prev) =>
      [...(prev ?? []), created].sort((a, b) => a.name.localeCompare(b.name))
    );
  }

  function removeRows(ids: (number | string)[]) {
    setUniversities((prev) => (prev ?? []).filter((u) => !ids.includes(u.id)));
  }

  const isFiltered = search.trim() !== "";

  return (
    <>
      <PageHeader heading="Universities" />

      {loadError && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)", marginBottom: "10px" }}>
          {loadError}
        </p>
      )}

      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        <Input
          placeholder="Search name, abbreviation or location"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          icon={<IconSearch size={16} />}
          size="md"
          font="sans"
          variant="secondary"
          style={{ width: "420px" }}
        />
        {/* Pushed to the right edge — the search sits with the table it
            filters, the action belongs opposite it. */}
        <Button variant="primary" size="md" onClick={() => setShowNew(true)} style={{ marginLeft: "auto" }}>
          <IconPlus />
          Add university
        </Button>
      </div>

      {universities === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
          <Spinner />
        </div>
      ) : visible.length === 0 ? (
        <Card radius="lg" style={{ padding: "8px 12px" }}>
          <EmptyState
            icon={<IconSchool size={26} />}
            title={isFiltered ? "No matching universities" : "No universities yet"}
            description={isFiltered
              ? "Try adjusting your search."
              : "Add the first one — users pick from this list on their profile."}
            action={isFiltered ? undefined : (
              <Button variant="secondary" size="md" onClick={() => setShowNew(true)}>
                <IconPlus />
                Add university
              </Button>
            )}
          />
        </Card>
      ) : (
        <Card radius="lg" style={{ padding: "8px 12px", overflowX: "auto" }}>
          <div
            className={table.table}
            style={{ gridTemplateColumns: COLUMNS, minWidth: `${MIN_TABLE_WIDTH}px` }}
          >
            <div className={table.header}>
              <span>Name</span>
              <span>Abbreviation</span>
              <span>Location</span>
              <span />
            </div>

            {visible.map((u) => (
              <UniversityRow
                key={u.id}
                university={u}
                onSave={(patch) => handleSave(u.id, patch)}
                onDelete={() => setDeleteTarget(u)}
              />
            ))}
          </div>
        </Card>
      )}

      {showNew && (
        <NewUniversityModal onClose={() => setShowNew(false)} onCreated={handleCreated} />
      )}

      {deleteTarget && (
        <BulkDeleteModal
          items={[deleteTarget]}
          noun="university"
          description={
            <>
              Delete <strong>{deleteTarget.name}</strong>? This is refused while anything still
              points at it — a member&rsquo;s profile, an alumni chapter, or a tournament track
              using it as a venue.
            </>
          }
          onDelete={(u) => run(`${u.name} deleted`, () => universitiesApi.delete(u.id))}
          onClose={() => setDeleteTarget(null)}
          onDeleted={removeRows}
        />
      )}
    </>
  );
}
