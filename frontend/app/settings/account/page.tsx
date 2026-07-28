"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { usersApi, authApi, UserMeFull, ApiError } from "@/lib/api";
import { validatePhone, validateDateOfBirth, formatPhone } from "@/lib/auth";
import { useFormattedInputChange } from "@/lib/useFormattedInput";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { Spinner } from "@/components/ui/Spinner";
import { FloatingSaveBar } from "@/components/ui/FloatingSaveBar";
import { SettingsSection, SettingsRow } from "@/components/settings/SettingsRow";

interface ProfileDraft {
  first_name:    string;
  last_name:     string;
  phone:         string;
  date_of_birth: string;
}

function toDraft(user: UserMeFull): ProfileDraft {
  return {
    first_name:    user.first_name,
    last_name:     user.last_name,
    phone:         user.phone ?? "",
    date_of_birth: user.date_of_birth ?? "",
  };
}

export default function AccountSettingsPage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [original, setOriginal] = useState<UserMeFull | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  // ── Email change — separate flow from the save bar ─────────────────────
  const [newEmail, setNewEmail] = useState("");
  const [emailRequestError, setEmailRequestError] = useState<string | undefined>(undefined);
  const [emailRequestSent, setEmailRequestSent] = useState<string | null>(null);
  const [emailRequesting, setEmailRequesting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) {
      router.replace("/");
      return;
    }

    usersApi.meFull()
      .then((user) => {
        setOriginal(user);
        setDraft(toDraft(user));
      })
      .catch(() => setLoadError("Failed to load account settings."));
  }, [authLoading, currentUser, router]);

  const isDirty = useMemo(() => {
    if (!original || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(toDraft(original));
  }, [draft, original]);

  const phoneChange = useFormattedInputChange(
    draft?.phone ?? "",
    (next) => setDraft((d) => (d ? { ...d, phone: next } : d)),
    formatPhone,
  );

  function handleCancel() {
    if (!original) return;
    setDraft(toDraft(original));
    setErrors({});
    setSaveError(undefined);
  }

  async function handleSave() {
    if (!original || !draft) return;
    setSaving(true);
    setSaveError(undefined);
    setErrors({});

    const phoneErr = validatePhone(draft.phone);
    if (phoneErr) {
      setErrors((e) => ({ ...e, phone: phoneErr }));
      setSaving(false);
      return;
    }

    const dobErr = draft.date_of_birth ? validateDateOfBirth(draft.date_of_birth) : null;
    if (dobErr) {
      setErrors((e) => ({ ...e, date_of_birth: dobErr }));
      setSaving(false);
      return;
    }

    try {
      const updated = await usersApi.updateMe({
        first_name:    draft.first_name,
        last_name:     draft.last_name,
        phone:         draft.phone,
        date_of_birth: draft.date_of_birth || null,
      });
      setOriginal(updated);
      setDraft(toDraft(updated));
    } catch (error: unknown) {
      setSaveError(error instanceof ApiError ? error.message : "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestEmailChange() {
    setEmailRequestError(undefined);
    setEmailRequesting(true);
    try {
      await authApi.requestEmailChange(newEmail);
      setEmailRequestSent(newEmail);
      setNewEmail("");
    } catch (error: unknown) {
      setEmailRequestError(error instanceof ApiError ? error.message : "Failed to send confirmation email.");
    } finally {
      setEmailRequesting(false);
    }
  }

  if (authLoading || (!original && !loadError)) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError || !original || !draft) {
    return (
      <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
        {loadError ?? "Account not found."}
      </p>
    );
  }

  return (
    <div style={{ paddingBottom: "60px" }}>
      <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", marginBottom: "28px" }}>
        Account
      </h1>

      <SettingsSection title="Profile">
        <SettingsRow label="First name">
          <Input
            fullWidth
            font="sans"
            value={draft.first_name}
            onChange={(e) => setDraft((d) => (d ? { ...d, first_name: e.target.value } : d))}
          />
        </SettingsRow>
        <SettingsRow label="Last name">
          <Input
            fullWidth
            font="sans"
            value={draft.last_name}
            onChange={(e) => setDraft((d) => (d ? { ...d, last_name: e.target.value } : d))}
          />
        </SettingsRow>
        <SettingsRow label="Phone">
          <Input
            fullWidth
            font="mono"
            type="tel"
            value={formatPhone(draft.phone)}
            onChange={(e) => {
              phoneChange(e);
              setErrors((er) => ({ ...er, phone: undefined }));
            }}
            error={errors.phone}
          />
        </SettingsRow>
        <SettingsRow label="Date of birth" last>
          <Input
            type="date"
            fullWidth
            value={draft.date_of_birth}
            onChange={(e) => {
              setDraft((d) => (d ? { ...d, date_of_birth: e.target.value } : d));
              setErrors((er) => ({ ...er, date_of_birth: undefined }));
            }}
            error={errors.date_of_birth}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Email">
        <SettingsRow label="Current email" helper="Changing your email requires confirming the new address.">
          <Input fullWidth font="sans" value={original.email} disabled />
        </SettingsRow>
        <SettingsRow label="New email" last>
          {emailRequestSent ? (
            <Banner variant="success" message={`Verification sent to ${emailRequestSent} — check your inbox.`} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <Input
                fullWidth
                font="sans"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                error={emailRequestError}
                placeholder="new@example.com"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRequestEmailChange}
                loading={emailRequesting}
                disabled={!newEmail}
              >
                Send confirmation
              </Button>
            </div>
          )}
        </SettingsRow>
      </SettingsSection>

      <FloatingSaveBar
        visible={isDirty}
        saving={saving}
        error={saveError}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </div>
  );
}
