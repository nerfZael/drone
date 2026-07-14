import { describe, expect, test } from 'bun:test';
import {
  canonicalJson,
  isGranted,
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
