import { describe, expect, test } from 'bun:test';
import {
  canonicalJson,
  DRONE_CONTROL_CAPABILITY,
  isGranted,
  pairingClaimSigningText,
  parsePairingPayload,
  PROVIDER_CREDENTIALS_CAPABILITY,
  runWorkspaceCommandJob,
} from '../src';

describe('device protocol', () => {
  test('canonical JSON is stable across key order', () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: false } })).toBe(
      canonicalJson({ nested: { a: false, b: true }, z: 1 }),
    );
  });

  test('default membership only permits discovery', () => {
    expect(isGranted([], 'device-core', 1, 'devices.list')).toBe(true);
    expect(isGranted([], 'drone-control', 1, 'drones.list')).toBe(false);
    expect(isGranted([], 'provider-credentials', 1, 'openai.export')).toBe(false);
  });

  test('advertises GROQ credential export as an explicit permission', () => {
    expect(PROVIDER_CREDENTIALS_CAPABILITY.operations).toContain('groq.export');
    expect(
      isGranted(
        [
          {
            capability: 'provider-credentials',
            version: 1,
            operations: ['groq.export'],
          },
        ],
        'provider-credentials',
        1,
        'groq.export',
      ),
    ).toBe(true);
  });

  test('advertises pull request reads and writes as separate permissions', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toEqual(
      expect.arrayContaining([
        'repo.pull-requests.read',
        'repo.pull-requests.merge',
        'repo.pull-requests.close',
      ]),
    );
    expect(
      isGranted(
        [
          {
            capability: 'drone-control',
            version: 1,
            operations: ['repo.pull-requests.read'],
          },
        ],
        'drone-control',
        1,
        'repo.pull-requests.merge',
      ),
    ).toBe(false);
  });

  test('advertises file preview as an explicit drone permission', () => {
    expect(DRONE_CONTROL_CAPABILITY.operations).toContain('file.preview');
    expect(
      isGranted(
        [{ capability: 'drone-control', version: 1, operations: ['chat.read'] }],
        'drone-control',
        1,
        'file.preview',
      ),
    ).toBe(false);
  });

  test('public pairing endpoints require a safe HTTPS origin', () => {
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'http://example.com',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'ftp://localhost:8791',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('HTTPS');
    expect(() =>
      parsePairingPayload({
        version: 1,
        endpoint: 'https://example.com/private/path',
        token: 'x',
        inviterDeviceId: 'a',
        expiresAt: 'now',
      }),
    ).toThrow('origin');
  });

  test('pairing identity proofs canonicalize public identity and endpoint details', () => {
    const claim = {
      token: 'pairing-token',
      claimSecret: 'claim-secret',
      inviterDeviceId: 'device_desktop',
      endpoint: 'https://desktop.example.test/',
      expiresAt: '2026-07-16T18:00:00.000Z',
      device: {
        id: 'device_phone',
        name: 'Phone',
        platform: 'android' as const,
        publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      },
    };
    expect(pairingClaimSigningText(claim)).toBe(
      pairingClaimSigningText({
        ...claim,
        endpoint: 'https://desktop.example.test',
        device: {
          ...claim.device,
          publicKey: {
            ...claim.device.publicKey,
            ext: true,
            key_ops: ['verify'],
          },
          ignoredBySigningText: true,
        },
      }),
    );
  });

  test('consumes asynchronous command output until the job completes', async () => {
    let outputCall = 0;
    const updates: string[] = [];
    const result = await runWorkspaceCommandJob({
      workspaceId: 'main',
      command: 'yarn build',
      request: async (operation) => {
        if (operation === 'commands.start')
          return { jobId: 'command_1', workspaceId: 'main', status: 'running' };
        outputCall += 1;
        return {
          jobId: 'command_1',
          workspaceId: 'main',
          status: outputCall === 1 ? 'running' : 'completed',
          cursor: outputCall,
          chunks: [
            {
              cursor: outputCall - 1,
              stream: 'stdout',
              text: outputCall === 1 ? 'building\n' : 'done\n',
            },
          ],
        };
      },
      onOutput: (update) => updates.push(update.text),
    });
    expect(result.text).toBe('status: completed\n\nbuilding\ndone\n');
    expect(updates).toEqual(['building\n', 'building\ndone\n']);
  });

  test('cancels the destination command job when its caller aborts', async () => {
    const controller = new AbortController();
    const operations: string[] = [];
    await expect(
      runWorkspaceCommandJob({
        workspaceId: 'main',
        command: 'yarn build',
        signal: controller.signal,
        request: async (operation) => {
          operations.push(operation);
          if (operation === 'commands.start')
            return { jobId: 'command_2', workspaceId: 'main', status: 'running' };
          if (operation === 'commands.output') {
            controller.abort();
            throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
          }
          return { status: 'cancelled' };
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(operations).toContain('commands.cancel');
  });
});
