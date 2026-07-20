import { describe, expect, test } from 'bun:test';
import {
  deviceMeshInvitationCheckDelay,
  deviceMeshInvitationNeedsRotation,
  INVITATION_REFRESH_LEAD_MS,
  INVITATION_STATUS_POLL_MS,
} from '../src/droneHub/app/device-mesh-invitation';
import type { MeshInvitation, MeshInvitationStatus } from '../src/droneHub/app/use-device-mesh';

const now = Date.parse('2026-07-20T10:00:00.000Z');

function invitation(overrides: Partial<MeshInvitation> = {}): MeshInvitation {
  const expiresAt = new Date(now + 10 * 60_000).toISOString();
  return {
    invitationId: 'invitation-1',
    qrSvg: '<svg />',
    expiresAt,
    payload: {
      version: 1,
      endpoint: 'https://current.example.com',
      token: 'secret',
      inviterDeviceId: 'device-desktop',
      expiresAt,
    },
    ...overrides,
  };
}

function status(overrides: Partial<MeshInvitationStatus> = {}): MeshInvitationStatus {
  const current = invitation();
  return {
    invitationId: current.invitationId,
    endpoint: current.payload.endpoint,
    expiresAt: current.expiresAt,
    claimed: false,
    ...overrides,
  };
}

describe('automatic device mesh invitation rotation', () => {
  test('creates a code when none exists', () => {
    expect(deviceMeshInvitationNeedsRotation(null, null, 'https://current.example.com', now)).toBe(
      true,
    );
  });

  test('keeps a current unclaimed code', () => {
    expect(
      deviceMeshInvitationNeedsRotation(invitation(), status(), 'https://current.example.com', now),
    ).toBe(false);
  });

  test('rotates after claim or an endpoint change', () => {
    expect(
      deviceMeshInvitationNeedsRotation(
        invitation(),
        status({ claimed: true }),
        'https://current.example.com',
        now,
      ),
    ).toBe(true);
    expect(
      deviceMeshInvitationNeedsRotation(invitation(), null, 'https://replacement.example.com', now),
    ).toBe(true);
  });

  test('rotates shortly before expiry', () => {
    const expiresAt = new Date(now + INVITATION_REFRESH_LEAD_MS).toISOString();
    expect(
      deviceMeshInvitationNeedsRotation(
        invitation({ expiresAt, payload: { ...invitation().payload, expiresAt } }),
        null,
        'https://current.example.com',
        now,
      ),
    ).toBe(true);
  });

  test('polls claim status without overshooting the refresh window', () => {
    expect(deviceMeshInvitationCheckDelay(invitation().expiresAt, now)).toBe(
      INVITATION_STATUS_POLL_MS,
    );
    expect(
      deviceMeshInvitationCheckDelay(
        new Date(now + INVITATION_REFRESH_LEAD_MS + 1_000).toISOString(),
        now,
      ),
    ).toBe(1_000);
  });
});
