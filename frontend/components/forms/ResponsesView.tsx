"use client";

import { useMemo, useState } from "react";
import { ResponseAnswers, wasEdited } from "@/components/forms/ResponseAnswers";
import styles from "@/components/forms/ResponsesView.module.css";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dropdown } from "@/components/ui/Dropdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormPopover } from "@/components/ui/FormPopover";
import {
  IconChevronLeft,
  IconMembers,
  IconSearch,
  IconSort,
  IconTrash,
} from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import type { FormField, FormRespondent, FormResponseManager } from "@/lib/api";
import { formatDateTime, formatRelativeTime } from "@/lib/timeFormat";

export function respondentName(r: FormRespondent): string {
  return `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.email;
}

type ResponseSort = "oldest" | "newest" | "name-asc" | "name-desc";

const SORT_OPTIONS: { value: ResponseSort; label: string }[] = [
  { value: "oldest", label: "Oldest" },
  { value: "newest", label: "Newest" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
];

function compareResponses(sort: ResponseSort, a: FormResponseManager, b: FormResponseManager) {
  switch (sort) {
    case "oldest":
      return Date.parse(a.submitted_at) - Date.parse(b.submitted_at);
    case "newest":
      return Date.parse(b.submitted_at) - Date.parse(a.submitted_at);
    case "name-asc":
      return respondentName(a.respondent).localeCompare(respondentName(b.respondent));
    case "name-desc":
      return respondentName(b.respondent).localeCompare(respondentName(a.respondent));
  }
}

// Two panes: a searchable respondent list, and the picked member's response
// read-only (ResponseAnswers, shared with a member viewing their own).
export function ResponsesView({
  fields,
  responses,
  deleteLockedReason,
  onDelete,
}: {
  /** Every question, archived ones included, with option values hydrated (formsApi.get). */
  fields: FormField[];
  responses: FormResponseManager[];
  /** Set when deleting isn't allowed — shown as the button's tooltip. */
  deleteLockedReason?: string;
  onDelete: (response: FormResponseManager) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ResponseSort>("oldest");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = query
      ? responses.filter(
          (r) =>
            respondentName(r.respondent).toLowerCase().includes(query) ||
            r.respondent.email.toLowerCase().includes(query),
        )
      : responses;
    return [...matching].sort((a, b) => compareResponses(sort, a, b));
  }, [responses, search, sort]);

  // A deleted response drops out of `responses`, which clears this too.
  const selected = responses.find((r) => r.id === selectedId) ?? null;

  return (
    <div className={styles.layout} data-selected={selected ? "true" : "false"}>
      <div className={styles.list}>
        <div style={{ display: "flex", gap: "8px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input
              placeholder="Search name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
              icon={<IconSearch size={16} />}
              size="md"
              font="sans"
              variant="secondary"
              fullWidth
            />
          </div>
          <FormPopover
            width={200}
            trigger={
              <Button type="button" variant="secondary" size="md" iconOnly title="Sort">
                <IconSort size={16} />
              </Button>
            }
          >
            {() => (
              <Dropdown
                label="Sort by"
                value={sort}
                onChange={(v) => setSort(v as ResponseSort)}
                options={SORT_OPTIONS}
                size="sm"
                fullWidth
              />
            )}
          </FormPopover>
        </div>
        <Card
          radius="lg"
          style={{ padding: "6px", display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          {visible.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<IconMembers size={18} />}
              title={responses.length === 0 ? "No responses yet" : "No matching respondents"}
            />
          ) : (
            <div className={styles.rows}>
              {visible.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`${styles.row} ${r.id === selectedId ? styles.rowSelected : ""}`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: "13px",
                        fontWeight: 500,
                        color: "var(--color-text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {respondentName(r.respondent)}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: "12px",
                      color: "var(--color-text-tertiary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.respondent.email} · {formatRelativeTime(r.submitted_at)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className={styles.detail}>
        {selected ? (
          <ResponseDetail
            fields={fields}
            response={selected}
            deleteLockedReason={deleteLockedReason}
            onBack={() => setSelectedId(null)}
            onDelete={() => onDelete(selected)}
          />
        ) : (
          <Card radius="lg">
            <EmptyState
              icon={<IconMembers size={26} />}
              title={responses.length === 0 ? "No responses yet" : "Select a respondent"}
              description={
                responses.length === 0
                  ? "Responses show up here once members submit the form."
                  : "Their answers show up here."
              }
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function ResponseDetail({
  fields,
  response,
  deleteLockedReason,
  onBack,
  onDelete,
}: {
  fields: FormField[];
  response: FormResponseManager;
  deleteLockedReason?: string;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      {/* Mobile only — the panes stack there, so the list needs a way back.
          The class sits on a wrapper: Button takes no className, and its
          inline display would beat the CSS anyway. */}
      <div className={styles.back}>
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <IconChevronLeft size={14} /> All responses
        </Button>
      </div>

      <Card
        radius="lg"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "14px 20px",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "15px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {respondentName(response.respondent)}
          </div>
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "12px",
              color: "var(--color-text-tertiary)",
              marginTop: "2px",
            }}
          >
            {response.respondent.email} · Submitted {formatDateTime(response.submitted_at)}
            {wasEdited(response) && ` · Updated ${formatDateTime(response.updated_at)}`}
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={!!deleteLockedReason}
          title={deleteLockedReason ?? "Delete this response"}
          onClick={onDelete}
          style={{ color: "var(--color-danger)", flexShrink: 0 }}
        >
          <IconTrash size={14} /> Delete
        </Button>
      </Card>

      <ResponseAnswers fields={fields} answers={response.answers} />
    </>
  );
}
