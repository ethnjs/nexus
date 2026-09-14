"use client";

import { useMemo, useState } from "react";
import {
  seasonEventsApi, CanonicalEvent, EventCategory, SeasonEvent,
  TournamentDivision, TOURNAMENT_DIVISIONS, ApiError,
} from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Dropdown } from "@/components/ui/Dropdown";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { IconSearch, IconPlus, IconX } from "@/components/ui/Icons";
import { useToast } from "@/lib/useToast";

const ALL_CATEGORIES = "__all__";

/** An event picked but not yet committed, with the divisions chosen for it. */
interface Staged {
  event: CanonicalEvent;
  divisions: TournamentDivision[];
}

/**
 * Add events to a season: pick an event, choose its divisions, repeat, then
 * commit the lot on Done.
 *
 * Divisions are per staged event rather than one setting for the batch —
 * most run in both B and C, but the exceptions are exactly what an admin is
 * here to set, and a single global choice would force a second pass for them.
 */
export function AddSeasonEventsModal({
  year, events, categories, existing, onClose, onAdded,
}: {
  year: number;
  events: CanonicalEvent[];
  categories: EventCategory[];
  /** Already in this season, keyed "eventId:division" — those pairs are skipped. */
  existing: Set<string>;
  onClose: () => void;
  onAdded: (created: SeasonEvent[]) => void;
}) {
  const { show } = useToast();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>(ALL_CATEGORIES);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const stagedIds = useMemo(() => new Set(staged.map((s) => s.event.id)), [staged]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return events.filter((e) => {
      if (categoryId !== ALL_CATEGORIES && String(e.category.id) !== categoryId) return false;
      if (!query) return true;
      return e.name.toLowerCase().includes(query);
    });
  }, [events, search, categoryId]);

  /** Divisions this event isn't already in — the only ones worth offering. */
  function availableDivisions(event: CanonicalEvent): TournamentDivision[] {
    return TOURNAMENT_DIVISIONS.filter((d) => !existing.has(`${event.id}:${d}`));
  }

  function stage(event: CanonicalEvent) {
    const available = availableDivisions(event);
    setStaged((prev) => [
      ...prev,
      // Defaults to B and C where they're free — the common case, still
      // changeable on the row.
      { event, divisions: available.filter((d) => d === "B" || d === "C") },
    ]);
  }

  function unstage(eventId: number) {
    setStaged((prev) => prev.filter((s) => s.event.id !== eventId));
  }

  function toggleDivision(eventId: number, value: string) {
    const division = value as TournamentDivision;
    setStaged((prev) => prev.map((s) =>
      s.event.id !== eventId ? s : {
        ...s,
        divisions: s.divisions.includes(division)
          ? s.divisions.filter((d) => d !== division)
          : [...s.divisions, division],
      }
    ));
  }

  // One row per (event, division) the commit will create.
  const pairs = useMemo(
    () => staged.flatMap((s) => s.divisions.map((division) => ({ event: s.event, division }))),
    [staged],
  );

  async function handleDone() {
    if (pairs.length === 0) { onClose(); return; }
    setError(undefined);
    setSaving(true);

    // Settled, not all-or-nothing: a pair that raced another admin (409)
    // shouldn't discard the rest.
    const outcomes = await Promise.allSettled(
      pairs.map(({ event, division }) =>
        seasonEventsApi.create({ event_id: event.id, year, division, is_active: true })
      )
    );
    const created = outcomes
      .filter((o): o is PromiseFulfilledResult<SeasonEvent> => o.status === "fulfilled")
      .map((o) => o.value);

    if (created.length > 0) onAdded(created);

    const failed = outcomes.length - created.length;
    if (failed === 0) {
      // One toast for the batch — a toast per pair would stack a dozen deep.
      show(`Added ${created.length} entr${created.length === 1 ? "y" : "ies"} to ${year}`, "success");
      onClose();
      return;
    }
    show(`${failed} of ${outcomes.length} couldn't be added`, "error");

    const first = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected");
    const reason = first?.reason instanceof ApiError ? first.reason.message : "Something went wrong.";
    setError(`${failed} of ${outcomes.length} couldn't be added: ${reason}`);
    setSaving(false);
  }

  return (
    <Modal title={`Add events to ${year}`} onClose={onClose} width={660}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {/* Staged first — it's the thing being built, and pushing it below the
            catalog would put it off-screen once the list scrolls. */}
        {staged.length > 0 && (
          <div style={{
            border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
            padding: "4px 12px", background: "var(--color-bg)",
          }}>
            {staged.map((row, i) => {
              const available = availableDivisions(row.event);
              return (
                <div
                  key={row.event.id}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px", padding: "10px 0",
                    borderBottom: i === staged.length - 1 ? "none" : "1px solid var(--color-border)",
                  }}
                >
                  <span style={{
                    fontFamily: "var(--font-sans)", fontSize: "13px", fontWeight: 500,
                    flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {row.event.name}
                  </span>
                  <ButtonGroup
                    options={available.map((d) => ({ value: d, label: d }))}
                    value={row.divisions}
                    onChange={(v) => toggleDivision(row.event.id, v)}
                  />
                  <Button
                    type="button" variant="secondary" size="sm" iconOnly
                    title="Remove" onClick={() => unstage(row.event.id)}
                  >
                    <IconX size={13} />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <Input
            placeholder="Search events"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            icon={<IconSearch size={14} />}
            size="sm"
            font="sans"
            fullWidth
          />
          {/* A dropdown, not a ButtonGroup: category names run to five words
              ("Life, Personal & Social Science") and as pills they wrapped into
              an unreadable three-line block. */}
          <Dropdown
            value={categoryId}
            onChange={setCategoryId}
            options={[
              { value: ALL_CATEGORIES, label: "All categories" },
              ...categories.map((c) => ({ value: String(c.id), label: c.name })),
            ]}
            size="sm"
            width={210}
          />
        </div>

        {/* Scrolls rather than growing the modal — the catalog is ~180 rows. */}
        <div style={{
          maxHeight: "280px", overflowY: "auto",
          border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
          padding: "4px 12px",
        }}>
          {visible.length === 0 ? (
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)", padding: "10px 0" }}>
              No events match.
            </p>
          ) : (
            visible.map((event, i) => {
              const full = availableDivisions(event).length === 0;
              const alreadyStaged = stagedIds.has(event.id);
              return (
                <div
                  key={event.id}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px", padding: "8px 0",
                    borderBottom: i === visible.length - 1 ? "none" : "1px solid var(--color-border)",
                    opacity: full || alreadyStaged ? 0.5 : 1,
                  }}
                >
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "13px", flex: 1, minWidth: 0 }}>
                    {event.name}
                  </span>
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                    {event.category.name}
                  </span>
                  <Button
                    type="button" variant="secondary" size="sm"
                    disabled={full || alreadyStaged}
                    title={full ? `Already in every division for ${year}` : alreadyStaged ? "Already added below" : "Add"}
                    onClick={() => stage(event)}
                  >
                    <IconPlus size={13} /> Add
                  </Button>
                </div>
              );
            })
          )}
        </div>

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "6px" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            {staged.length === 0
              ? "Nothing added yet"
              : `${staged.length} event${staged.length === 1 ? "" : "s"} · ${pairs.length} division entr${pairs.length === 1 ? "y" : "ies"}`}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button
              type="button" variant="primary" loading={saving}
              disabled={pairs.length === 0}
              onClick={handleDone}
            >
              Done
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
