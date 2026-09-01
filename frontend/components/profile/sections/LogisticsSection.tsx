import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/profile/SectionHeading";
import { PanelField, FieldValue, FieldGrid, TextField } from "@/components/profile/PanelField";

interface LogisticsUser {
  shirt_size: "XS" | "S" | "M" | "L" | "XL" | "XXL" | null;
  dietary_restriction: string | null;
}

export function LogisticsSection({ user }: { user: LogisticsUser }) {
  return (
    <SectionHeading title="Logistics">
      <FieldGrid>
        <PanelField label="Shirt Size">
          {user.shirt_size !== null ? (
            <Badge variant="default">{user.shirt_size}</Badge>
          ) : (
            <FieldValue muted>No info yet</FieldValue>
          )}
        </PanelField>
        <TextField label="Dietary Restriction" value={user.dietary_restriction} />
      </FieldGrid>
    </SectionHeading>
  );
}
