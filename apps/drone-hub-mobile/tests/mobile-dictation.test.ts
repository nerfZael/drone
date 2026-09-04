import { describe, expect, test } from 'bun:test';
import {
  appendMobileDictationTranscript,
  drainReadyMobileDictationTranscripts,
  type MobileOrderedTranscription,
} from '../src/local-assistant/mobile-dictation-queue';
import { resolveMobileDictationTarget } from '../src/local-assistant/mobile-dictation-target';
import type { MobileDroneSummary } from '../src/drones/drone-sidebar-model';

const selectedDrone: MobileDroneSummary = {
  id: 'drone-1',
  name: 'Falcon',
  runtime: 'container',
  phase: 'ready',
  status: 'Ready',
  group: 'Mobile',
  repoPath: '/work/repo',
  fleetParentId: null,
  chats: ['default', 'planning'],
  busyChats: [],
};

const targetInput = {
  deviceId: 'device-1',
  targetReachable: true,
  selectedDrone,
  chatName: 'planning',
  agent: 'codex' as const,
  agentPermissionMode: 'execute' as const,
  approvalPolicy: 'ask' as const,
  provider: 'codex',
  model: 'gpt-5.6',
  reasoning: 'high',
};

describe('mobile dictation', () => {
  test('appends concurrently completed transcripts in recording order', () => {
    const queue: MobileOrderedTranscription[] = [
      { status: 'pending', text: '' },
      { status: 'ready', text: 'second recording' },
    ];

    expect(drainReadyMobileDictationTranscripts(queue)).toEqual([]);
    queue[0] = { status: 'ready', text: 'first recording' };
    expect(drainReadyMobileDictationTranscripts(queue)).toEqual([
      'first recording',
      'second recording',
    ]);
    expect(queue).toEqual([]);
  });

  test('keeps later transcripts queued behind a failed earlier recording', () => {
    const queue: MobileOrderedTranscription[] = [
      { status: 'failed', text: '' },
      { status: 'ready', text: 'later recording' },
    ];

    expect(drainReadyMobileDictationTranscripts(queue)).toEqual([]);
    expect(queue).toHaveLength(2);
    queue.shift();
    expect(drainReadyMobileDictationTranscripts(queue)).toEqual(['later recording']);
  });

  test('preserves editor formatting while appending a new transcript', () => {
    expect(appendMobileDictationTranscript('typed notes\n', ' recorded thought ')).toBe(
      'typed notes\nrecorded thought',
    );
    expect(appendMobileDictationTranscript('typed notes', 'recorded thought')).toBe(
      'typed notes\nrecorded thought',
    );
  });

  test('resolves current chat and cloned chat against the visible chat', () => {
    expect(
      resolveMobileDictationTarget({ ...targetInput, destination: 'current-chat' }),
    ).toMatchObject({
      ok: true,
      target: {
        destination: 'current-chat',
        deviceId: 'device-1',
        droneId: 'drone-1',
        chatName: 'planning',
      },
    });
    expect(
      resolveMobileDictationTarget({ ...targetInput, destination: 'clone-chat' }),
    ).toMatchObject({
      ok: true,
      target: {
        destination: 'clone-chat',
        droneId: 'drone-1',
        chatName: 'planning',
      },
    });
  });

  test('keeps root drones ungrouped and group drones in the current group', () => {
    expect(
      resolveMobileDictationTarget({ ...targetInput, destination: 'root-drone' }),
    ).toMatchObject({
      ok: true,
      target: {
        destination: 'root-drone',
        repoPath: '/work/repo',
        group: '',
        agent: 'codex',
        model: 'gpt-5.6',
      },
    });
    expect(
      resolveMobileDictationTarget({ ...targetInput, destination: 'group-drone' }),
    ).toMatchObject({
      ok: true,
      target: {
        destination: 'group-drone',
        repoPath: '/work/repo',
        group: 'Mobile',
      },
    });
  });

  test('rejects destinations without an online selected drone', () => {
    expect(
      resolveMobileDictationTarget({
        ...targetInput,
        destination: 'current-chat',
        targetReachable: false,
      }),
    ).toEqual({ ok: false, error: 'The selected Drone Hub device is offline.' });
    expect(
      resolveMobileDictationTarget({
        ...targetInput,
        destination: 'root-drone',
        selectedDrone: null,
      }),
    ).toEqual({ ok: false, error: 'Open a drone chat before using this destination.' });
  });
});
