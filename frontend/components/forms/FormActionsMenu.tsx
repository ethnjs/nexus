"use client";

import { useState } from "react";
import { formsApi, ApiError } from "@/lib/api";
import { useToast } from "@/lib/useToast";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { IconCopy, IconDotsVertical } from "@/components/ui/Icons";

interface MenuItem {
  key: string;
  label: string;
}

const ITEMS: MenuItem[] = [{ key: "copy-json", label: "Copy JSON" }];

// Debug/support-facing escape hatch, not a TD-facing feature — copies the
// form exactly as a respondent's form-renderer request would see it
// (formsApi.get, not getForEdit's raw=true), since the point is inspecting
// what actually gets rendered/submitted against, hydrated option values
// included.
export function FormActionsMenu({ formId }: { formId: string }) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  async function copyJson() {
    setBusy(true);
    try {
      const form = await formsApi.get(formId);
      await navigator.clipboard.writeText(JSON.stringify(form, null, 2));
      show("Copied form JSON to clipboard");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Failed to copy form JSON.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      trigger={
        <Button type="button" variant="ghost" size="md" iconOnly title="More options" disabled={busy}>
          <IconDotsVertical size={16} />
        </Button>
      }
      items={ITEMS}
      getKey={(item) => item.key}
      renderLabel={(item) => (
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <IconCopy size={13} /> {item.label}
        </span>
      )}
      onSelect={() => copyJson()}
      width={170}
    />
  );
}
