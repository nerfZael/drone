import type { MeshInvitation, MeshInvitationStatus } from './use-device-mesh';

export const INVITATION_REFRESH_LEAD_MS = 30_000;
export const INVITATION_STATUS_POLL_MS = 3_000;

export function deviceMeshInvitationNeedsRotation(
  invitation: MeshInvitation | null,
  status: MeshInvitationStatus | null,
  endpoint: string,
  now = Date.now(),
): boolean {
  if (!invitation) return true;
  if (invitation.payload.endpoint !== endpoint) return true;
  const expiresAt = Date.parse(invitation.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now + INVITATION_REFRESH_LEAD_MS) return true;
  if (!status) return false;
  return (
    status.invitationId !== invitation.invitationId ||
    status.claimed ||
    status.endpoint !== endpoint ||
    status.expiresAt !== invitation.expiresAt
  );
}

export function deviceMeshInvitationCheckDelay(expiresAtRaw: string, now = Date.now()): number {
  const expiresAt = Date.parse(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(
    0,
    Math.min(INVITATION_STATUS_POLL_MS, expiresAt - now - INVITATION_REFRESH_LEAD_MS),
  );
}
