"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ButtonGroup } from "@/components/ui/ButtonGroup";
import { Dropdown } from "@/components/ui/Dropdown";
import { ChipInput, ChipStatus } from "@/components/ui/ChipInput";
import { invitesApi, membershipsApi, staffInvitesApi, Invite, StaffInviteResponse, ApiError } from "@/lib/api";
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
    membershipsApi.list(tournamentId)
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
    return (
      <Modal title="Invites sent" onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {result.sent.length > 0 && (
            <div>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: 600, color: "var(--color-success)", marginBottom: "4px" }}>
                Sent ({result.sent.length})
              </p>
              {result.sent.map((email) => (
                <p key={email} style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                  {email}
                </p>
              ))}
            </div>
          )}
          {result.failed.length > 0 && (
            <div>
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "12px", fontWeight: 600, color: "var(--color-danger)", marginBottom: "4px" }}>
                Failed ({result.failed.length})
              </p>
              {result.failed.map((email) => (
                <p key={email} style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                  {email}
                </p>
              ))}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
            <Button type="button" variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Invite staff" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {invites !== null && invites.length > 0 && (
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
            options={(invites ?? []).map((i) => ({
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
