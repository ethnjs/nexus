"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { IconPlus } from "@/components/ui/Icons";

export interface AddableMember {
  id: number;
  name: string;
}

/**
 * A track's add control: a button that turns into a search field for placing
 * someone by name. It stays open after each pick, so several people can go
 * on in a row; Escape or clicking away folds it back.
 */
export function AddMemberChip({
  candidates,
  onAdd,
  trigger = "row",
}: {
  /** Read when the field opens and after each pick. */
  candidates: () => AddableMember[];
  onAdd: (membershipId: number) => void;
  /** `row` is a full-width dashed row under a timeline, `icon` a "+" beside
   *  chips as on the roster's roles, and `button` an empty state's action. */
  trigger?: "row" | "icon" | "button";
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  if (!editing && trigger === "button") {
    return (
      <Button
        type="button"
        variant="secondary"
        size="xs"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setEditing(true)}
      >
        <IconPlus size={11} /> Add member
      </Button>
    );
  }

  if (!editing && trigger === "icon") {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        iconOnly
        title="Add member"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setEditing(true)}
        style={{ padding: 0, flexShrink: 0 }}
      >
        <IconPlus size={14} />
      </Button>
    );
  }

  if (!editing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setEditing(true)}
        style={{
          border: "1px dashed var(--color-border-strong)",
          color: "var(--color-text-secondary)",
          width: "100%",
        }}
      >
        <IconPlus size={11} /> Add
      </Button>
    );
  }

  function close() {
    setText("");
    setEditing(false);
  }

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // The combobox takes the first Escape to close its list.
        if (e.key === "Escape" && !e.defaultPrevented) close();
      }}
      style={trigger === "row" ? { width: "100%" } : { width: "200px", flexShrink: 0 }}
    >
      <Combobox
        options={candidates()}
        getId={(member) => member.id}
        getLabel={(member) => member.name}
        value={text}
        onChange={(next) => setText(next)}
        onSelect={(member) => {
          onAdd(member.id);
          setText("");
        }}
        allowFreeText={false}
        placeholder="Type a name"
        emptyMessage="No one left to add"
        size="sm"
        font="sans"
        variant="secondary"
        stayOpenOnSelect
        autoFocus
        onBlur={close}
      />
    </div>
  );
}
