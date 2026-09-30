"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/useAuth";
import { authApi, usersApi, ApiError, OAuthIdentity } from "@/lib/api";
import { checkPassword, validatePassword, PasswordChecks, googleAuthErrorMessage } from "@/lib/auth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/ui/Banner";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsRow";
import { PageHeader } from "@/components/ui/PageHeader";
import { PasswordChecklist } from "@/components/auth/PasswordChecklist";
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
  const [passwordJustSet, setPasswordJustSet] = useState(false);
  const hasPassword = passwordJustSet || (currentUser?.has_password ?? true);
  const [googleIdentity, setGoogleIdentity] = useState<OAuthIdentity | null>(null);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [unlinking, setUnlinking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) router.replace("/");
  }, [authLoading, currentUser, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("linked") === "google") setNotice("Google is connected.");
    const err = googleAuthErrorMessage(params.get("error"));
    if (err) setNoticeError(err);
  }, []);

  useEffect(() => {
    usersApi.identities()
      .then((rows) => setGoogleIdentity(rows.find((row) => row.provider === "google") ?? null))
      .catch(() => {})
      .finally(() => setIdentitiesLoading(false));
  }, []);

  async function handleUnlink() {
    setUnlinking(true);
    setNotice(null);
    setNoticeError(null);
    try {
      await usersApi.unlinkGoogle();
      setGoogleIdentity(null);
      setNotice("Google was disconnected.");
    } catch (error: unknown) {
      setNoticeError(error instanceof ApiError ? error.message : "Something went wrong. Try again.");
    } finally {
      setUnlinking(false);
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setErrors({});
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
      await authApi.setPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setChecks(EMPTY_CHECKS);
      setPasswordJustSet(true);
      setSuccess(true);
    } catch (error: unknown) {
      setErrors((er) => ({ ...er, form: error instanceof ApiError ? error.message : "Something went wrong. Try again." }));
    } finally {
      setSubmitting(false);
    }
  }

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
      <PageHeader heading="Security" />

      {(notice || noticeError) && (
        <div style={{ marginBottom: "16px" }}>
          <Banner variant={noticeError ? "error" : "success"} message={noticeError ?? notice ?? ""} />
        </div>
      )}

      <SettingsSection title="Connected accounts">
        <SettingsRow
          label="Google"
          helper={googleIdentity?.email_at_provider ?? "Sign in with Google as well as your password."}
          last
        >
          {identitiesLoading ? null : googleIdentity ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                loading={unlinking}
                disabled={!hasPassword}
                onClick={handleUnlink}
              >
                Disconnect
              </Button>
              {!hasPassword && (
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", margin: "8px 0 0" }}>
                  Set a password before disconnecting Google, or you won&rsquo;t be able to sign in.
                </p>
              )}
            </div>
          ) : (
            <a
              href={authApi.googleStartUrl("link")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                height: "36px",
                padding: "0 16px",
                boxSizing: "border-box",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                fontWeight: 600,
                letterSpacing: "0.01em",
                textDecoration: "none",
              }}
            >
              Connect
            </a>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Password">
        {!hasPassword ? (
          <form onSubmit={handleSetPassword}>
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
                <Banner variant="success" message="Your password has been set." />
              </div>
            )}
            {errors.form && (
              <div style={{ marginBottom: "16px" }}>
                <Banner variant="error" message={errors.form} />
              </div>
            )}
            <Button type="submit" variant="primary" loading={submitting} style={{ marginBottom: "20px" }}>
              Set password
            </Button>
          </form>
        ) : (
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

          <Button type="submit" variant="primary" loading={submitting} style={{marginBottom: "20px"}}>
            Update password
          </Button>
        </form>
        )}
      </SettingsSection>

      <SettingsSection title="Sessions">
        <SessionList />
      </SettingsSection>
    </div>
  );
}
