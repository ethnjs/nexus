import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue, FieldGrid, TextField } from "@/components/profile/PanelField";

interface LogisticsUser {
  shirt_size: "XS" | "S" | "M" | "L" | "XL" | "XXL" | null;
  dietary_restriction: string | null;
}

export function LogisticsSection({ user, hiddenFields }: {
  user: LogisticsUser;
  /** Field ids the TD turned off — matches the backend's PANEL_SECTIONS entry for "logistics". */
  hiddenFields?: Set<string>;
}) {
  const shows = (field: string) => !hiddenFields?.has(field);
  return (
    <SectionHeading title="Logistics">
      <FieldGrid>
        {shows("shirt_size") && <PanelField label="Shirt Size">
          {user.shirt_size !== null ? (
            <Badge variant="default">{user.shirt_size}</Badge>
          ) : (
            <FieldValue muted>No info yet</FieldValue>
          )}
        </PanelField>}
        {shows("dietary_restriction") && (
          <TextField label="Dietary Restriction" value={user.dietary_restriction} />
        )}
      </FieldGrid>
    </SectionHeading>
  );
}
