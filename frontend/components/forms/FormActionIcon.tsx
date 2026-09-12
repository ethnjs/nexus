"use client";

import { FormStatusAction } from "@/lib/forms/formStatusActions";
import { IconArchive, IconBan, IconRestore, IconRocket, IconTrash } from "@/components/ui/Icons";

/** One icon per status action, shared by the builder menu and the forms table. */
export function FormActionIcon({ action, size = 14 }: { action: FormStatusAction; size?: number }) {
  switch (action) {
    case "publish": return <IconRocket size={size} />;
    // Red on the icon itself: unpublishing takes a live form down, but it
    // isn't destructive, so it doesn't get the whole danger treatment.
    case "unpublish": return <IconBan size={size} style={{ color: "var(--color-danger)" }} />;
    case "restore": return <IconRestore size={size} />;
    case "archive": return <IconArchive size={size} />;
    case "delete": return <IconTrash size={size} />;
  }
}
