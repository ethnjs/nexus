"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PasswordChecklist } from "@/components/auth/PasswordChecklist";
import { SessionList } from "@/components/settings/SessionList";
import { SettingsRow, SettingsSection } from "@/components/settings/SettingsRow";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { IconDiscord } from "@/components/ui/Icons";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { ApiError, authApi, type OAuthIdentity, usersApi } from "@/lib/api";
import {
  checkPassword,
  discordLinkErrorMessage,
  EMPTY_PASSWORD_CHECKS,
  googleAuthErrorMessage,
  type PasswordChecks,
  validatePassword,
} from "@/lib/auth";
import { DISCORD_VOLUNTEER_GUIDE_URL } from "@/lib/docs";
import { useAuth } from "@/lib/useAuth";

export default function SecuritySettingsPage() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [checks, setChecks] = useState<PasswordChecks>(EMPTY_PASSWORD_CHECKS);

  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [passwordJustSet, setPasswordJustSet] = useState(false);
  const hasPassword = passwordJustSet || (currentUser?.has_password ?? true);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) router.replace("/");
  }, [authLoading, currentUser, router]);

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
      setChecks(EMPTY_PASSWORD_CHECKS);
      setPasswordJustSet(true);
      setSuccess(true);
    } catch (error: unknown) {
      setErrors((er) => ({
        ...er,
        form: error instanceof ApiError ? error.message : "Something went wrong. Try again.",
      }));
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
      setChecks(EMPTY_PASSWORD_CHECKS);
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

      <SettingsSection title="Connected accounts">
        <Suspense>
          <ConnectedAccounts hasPassword={hasPassword} />
        </Suspense>
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
            {errors.form && (
              <div style={{ marginBottom: "16px" }}>
                <Banner variant="error" message={errors.form} />
              </div>
            )}
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              style={{ marginBottom: "20px" }}
            >
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
                <Banner
                  variant="success"
                  message={
                    passwordJustSet
                      ? "Your password has been set."
                      : "Your password has been changed."
                  }
                />
              </div>
            )}
            {errors.form && (
              <div style={{ marginBottom: "16px" }}>
                <Banner variant="error" message={errors.form} />
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              style={{ marginBottom: "20px" }}
            >
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

function ConnectedAccounts({ hasPassword }: { hasPassword: boolean }) {
  const searchParams = useSearchParams();
  const [identities, setIdentities] = useState<OAuthIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlinking, setUnlinking] = useState<"google" | "discord" | null>(null);
  const linked = searchParams.get("linked");
  const [notice, setNotice] = useState<string | null>(
    linked === "discord"
      ? "Discord is connected."
      : linked === "google"
        ? "Google is connected."
        : null,
  );
  const [error, setError] = useState<string | null>(
    discordLinkErrorMessage(searchParams.get("error")) ??
      googleAuthErrorMessage(searchParams.get("error")),
  );
  const google = identities.find((row) => row.provider === "google");
  const discord = identities.find((row) => row.provider === "discord");

  useEffect(() => {
    usersApi
      .identities()
      .then(setIdentities)
      .catch(() => setError("Couldn't load connected accounts."))
      .finally(() => setLoading(false));
  }, []);

  async function handleUnlink(provider: "google" | "discord") {
    setUnlinking(provider);
    setNotice(null);
    setError(null);
    try {
      await (provider === "google" ? usersApi.unlinkGoogle() : usersApi.unlinkDiscord());
      setIdentities((rows) => rows.filter((row) => row.provider !== provider));
      setNotice(`${provider === "google" ? "Google" : "Discord"} was disconnected.`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setUnlinking(null);
    }
  }

  return (
    <>
      <SettingsRow
        label="Google"
        helper={
          google && !hasPassword
            ? "Set a password before disconnecting Google, or you won't be able to sign in."
            : (google?.email_at_provider ?? "Sign in with Google as well as your password.")
        }
      >
        {loading ? null : google ? (
          <Button
            variant="secondary"
            loading={unlinking === "google"}
            disabled={!hasPassword}
            onClick={() => handleUnlink("google")}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => window.location.assign(authApi.googleStartUrl("link"))}
          >
            Connect
          </Button>
        )}
      </SettingsRow>
      <SettingsRow
        label={
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <IconDiscord />
            Discord
          </span>
        }
        helper={
          discord ? (
            `@${discord.username_at_provider ?? "unknown"}`
          ) : (
            <>
              Link Discord to get your roles and channels on tournament servers.{" "}
              <a
                href={DISCORD_VOLUNTEER_GUIDE_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "inherit",
                  textDecoration: "underline",
                  textUnderlineOffset: "2px",
                }}
              >
                Read the Discord guide
              </a>
            </>
          )
        }
        last
      >
        {loading ? null : discord ? (
          <Button
            variant="secondary"
            loading={unlinking === "discord"}
            onClick={() => handleUnlink("discord")}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => window.location.assign(authApi.discordStartUrl("/settings/security"))}
          >
            Connect
          </Button>
        )}
      </SettingsRow>
      {(notice || error) && (
        <div style={{ marginBottom: "16px" }}>
          <Banner variant={error ? "error" : "success"} message={error ?? notice ?? ""} />
        </div>
      )}
    </>
  );
}
