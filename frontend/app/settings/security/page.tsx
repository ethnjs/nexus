"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { authApi, ApiError } from "@/lib/api";
import { checkPassword, validatePassword, PasswordChecks } from "@/lib/auth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsRow";
import { SettingsPageHeading } from "@/components/settings/SettingsPageHeading";
import { PasswordChecklist } from "@/components/settings/PasswordChecklist";
import { SessionList } from "@/components/settings/SessionList";

const EMPTY_CHECKS: PasswordChecks = {
  length: false, upper: false, lower: false, number: false, symbol: false, confirm: false,
};

export default function SecuritySettingsPage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [checks, setChecks] = useState<PasswordChecks>(EMPTY_CHECKS);

  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) router.replace("/");
  }, [authLoading, currentUser, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setErrors({});

    if (!currentPassword) {
      setErrors((er) => ({ ...er, current_password: "Cannot be empty." }));
      return;
    }

    const passwordErr = validatePassword(newPassword);
    if (passwordErr) {
      setErrors((er) => ({ ...er, new_password: passwordErr }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrors((er) => ({ ...er, confirm_password: "Passwords don't match." }));
      return;
    }

    setSubmitting(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setChecks(EMPTY_CHECKS);
      setSuccess(true);
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 401) {
        setErrors((er) => ({ ...er, current_password: error.message }));
      } else {
        setErrors((er) => ({ ...er, form: "Something went wrong. Try again." }));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <SettingsPageHeading title="Security" />

      <SettingsSection title="Password">
        <form onSubmit={handleSubmit}>
          <SettingsRow label="Current password">
            <Input
              fullWidth
              font="sans"
              type="password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setErrors((er) => ({ ...er, current_password: undefined }));
              }}
              autoComplete="current-password"
              error={errors.current_password}
            />
          </SettingsRow>
          <SettingsRow label="New password">
            <Input
              fullWidth
              font="sans"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setChecks(checkPassword(e.target.value, confirmPassword));
                setErrors((er) => ({ ...er, new_password: undefined }));
              }}
              autoComplete="new-password"
              error={errors.new_password}
            />
          </SettingsRow>
          <SettingsRow label="Confirm new password" last>
            <Input
              fullWidth
              font="sans"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setChecks(checkPassword(newPassword, e.target.value));
                setErrors((er) => ({ ...er, confirm_password: undefined }));
              }}
              autoComplete="new-password"
              error={errors.confirm_password}
            />
          </SettingsRow>

          {newPassword && (
            <div style={{ margin: "20px 0" }}>
              <PasswordChecklist checks={checks} />
            </div>
          )}

          {success && (
            <div style={{ marginBottom: "16px" }}>
              <Banner variant="success" message="Your password has been changed." />
            </div>
          )}
          {errors.form && (
            <div style={{ marginBottom: "16px" }}>
              <Banner variant="error" message={errors.form} />
            </div>
          )}

          <Button type="submit" variant="primary" loading={submitting}>
            Update password
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection title="Sessions">
        <SessionList />
      </SettingsSection>
    </div>
  );
}
