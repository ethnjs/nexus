"use client";

import { useState } from "react";
import {
  EVENT_CARD_FIELDS,
  type EventCardField,
} from "@/components/tournament/buildings/EventListCard";
import { Button } from "@/components/ui/Button";
import { CheckboxRow } from "@/components/ui/CheckboxRow";
import { Modal } from "@/components/ui/Modal";

/** Which details the buildings page's event cards show. Name and division
 *  always show, so they aren't offered. */
export function EventCardDisplayModal({
  hidden,
  onApply,
  onClose,
}: {
  hidden: ReadonlySet<EventCardField>;
  onApply: (hidden: Set<EventCardField>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => new Set(hidden));

  function toggle(id: EventCardField) {
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal title="Configure event cards" onClose={onClose} width={360}>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {EVENT_CARD_FIELDS.map((field) => (
          <CheckboxRow
            key={field.id}
            label={field.label}
            checked={!draft.has(field.id)}
            onChange={() => toggle(field.id)}
          />
        ))}
      </div>

      <div
        style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "16px" }}
      >
        <Button type="button" variant="ghost" onClick={() => setDraft(new Set())}>
          Reset
        </Button>
        <div style={{ display: "flex", gap: "8px" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
