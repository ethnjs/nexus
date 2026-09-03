"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { Spinner } from "@/components/ui/Spinner";
import { ChipInput, ChipStatus } from "@/components/ui/ChipInput";
import { IconCheckCircle, IconXCircle } from "@/components/ui/Icons";
import { invitesApi, membersApi, staffInvitesApi, Invite, StaffInviteResponse, ApiError } from "@/lib/api";
import { PRESET_HOURS } from "@/lib/invitePresets";
import { InviteFields } from "@/components/tournament/settings/InviteFields";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface StaffInviteModalProps {
  tournamentId: number;
  onClose: () => void;
  /** Fires after a successful send — e.g. so a caller can refetch the setup checklist. */
  onSent?: (response: StaffInviteResponse) => void;
}

export function StaffInviteModal({ tournamentId, onClose, onSent }: StaffInviteModalProps) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [memberEmails, setMemberEmails] = useState<Set<string> | null>(null);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedInviteId, setSelectedInviteId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [preset, setPreset] = useState("1d");
  const [emails, setEmails] = useState<string[]>([]);

  const [error, setError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<StaffInviteResponse | null>(null);

  useEffect(() => {
    invitesApi.list(tournamentId).then((list) => {
      setInvites(list);
      if (list.length === 0) setMode("new");
      else setSelectedInviteId(String(list[0].id));
    });
    // manage_invites alone (no manage_members) 403s here — that's fine, we
    // just skip the "already a member" warning entirely in that case.
    membersApi.list(tournamentId)
      .then((members) => setMemberEmails(new Set(members.map((m) => m.user.email.toLowerCase()))))
      .catch(() => setMemberEmails(null));
  }, [tournamentId]);

  function getChipStatus(chip: string): ChipStatus {
    if (!EMAIL_PATTERN.test(chip)) return "error";
    if (memberEmails?.has(chip.toLowerCase())) return "warning";
    return "default";
  }

  const hasInvalid = emails.some((e) => !EMAIL_PATTERN.test(e));
  const hasWarning = emails.some((e) => EMAIL_PATTERN.test(e) && memberEmails?.has(e.toLowerCase()));

  async function handleSend() {
    setError(undefined);

    if (emails.length === 0) {
      setError("Enter at least one email address.");
      return;
    }
    if (hasInvalid) {
      setError("Fix invalid email addresses before sending.");
      return;
    }

    const toSend = emails.filter((e) => !memberEmails?.has(e.toLowerCase()));
    if (toSend.length === 0) {
      setError("All entered emails already belong to members of this tournament.");
      return;
    }

    setSending(true);
    try {
      let joinCodeId: number;
      if (mode === "new") {
        const invite = await invitesApi.create(tournamentId, {
          label: label.trim() || null,
          expires_in_hours: preset === "forever" ? null : PRESET_HOURS[preset],
        });
        joinCodeId = invite.id;
      } else {
        joinCodeId = Number(selectedInviteId);
      }

      const response = await staffInvitesApi.send(tournamentId, { join_code_id: joinCodeId, emails: toSend });
      setResult(response);
      onSent?.(response);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (result) {
    const allSucceeded = result.failed.length === 0;
    return (
      <Modal title="Invite staff" onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "4px 0" }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "48px", height: "48px", borderRadius: "50%",
              background: allSucceeded ? "var(--color-success-subtle)" : "var(--color-warning-subtle)",
              color: allSucceeded ? "var(--color-success)" : "var(--color-warning)",
              marginBottom: "12px",
            }}>
              {allSucceeded ? <IconCheckCircle size={26} /> : <IconXCircle size={26} />}
            </div>
            <p style={{ fontFamily: "var(--font-serif)", fontSize: "19px", color: "var(--color-text-primary)" }}>
              {result.sent.length} invite{result.sent.length === 1 ? "" : "s"} sent
            </p>
            {!allSucceeded && (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                {result.failed.length} failed to send
              </p>
            )}
          </div>

          <div style={{
            border: "1px solid var(--color-border)", borderRadius: "var(--radius-lg)",
            overflow: "hidden",
          }}>
            {[...result.sent.map((email) => ({ email, ok: true })), ...result.failed.map((email) => ({ email, ok: false }))]
              .map(({ email, ok }, i, arr) => (
                <div
                  key={email}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px", padding: "9px 12px",
                    borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--color-border)",
                  }}
                >
                  {ok ? (
                    <IconCheckCircle size={15} style={{ color: "var(--color-success)" }} />
                  ) : (
                    <IconXCircle size={15} style={{ color: "var(--color-danger)" }} />
                  )}
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: "13px",
                    color: ok ? "var(--color-text-primary)" : "var(--color-danger)",
                  }}>
                    {email}
                  </span>
                </div>
              ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button type="button" variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (invites === null) {
    return (
      <Modal title="Invite staff" onClose={onClose}>
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
          <Spinner size="lg" />
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Invite staff" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {invites.length > 0 && (
          <ButtonGroup
            options={[
              { value: "existing", label: "Use existing invite" },
              { value: "new", label: "Create new invite" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "existing" | "new")}
            fullWidth
          />
        )}

        {mode === "existing" ? (
          <Dropdown
            label="Invite"
            value={selectedInviteId}
            onChange={setSelectedInviteId}
            options={invites.map((i) => ({
              value: String(i.id),
              label: i.label ? `${i.label} — ${i.code}` : i.code,
            }))}
            fullWidth
          />
        ) : (
          <InviteFields label={label} onLabelChange={setLabel} preset={preset} onPresetChange={setPreset} />
        )}

        <ChipInput
          label="Emails"
          placeholder="Type an email and press Enter"
          value={emails}
          onChange={setEmails}
          getChipStatus={getChipStatus}
          fullWidth
        />
        {hasWarning && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", color: "var(--color-warning)" }}>
            Highlighted emails already belong to members of this tournament — they won&rsquo;t be sent an invite.
          </p>
        )}

        {error && (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "6px" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button type="button" variant="primary" loading={sending} onClick={handleSend}>
            Send invites
          </Button>
        </div>
      </div>
    </Modal>
  );
}
