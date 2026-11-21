import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatDateOfBirth } from "@/lib/auth";

// Asked for every new date, whatever the age, so it catches typos without hinting at limits.
export function ConfirmDateOfBirthModal({
  value,
  onConfirm,
  onClose,
}: {
  value: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <ConfirmModal
      title="Confirm your date of birth"
      description={`Is ${formatDateOfBirth(value)} your correct date of birth?`}
      confirmLabel="Yes, that's right"
      variant="primary"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
