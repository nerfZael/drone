import { describe, expect, test } from 'bun:test';
import {
  buildTranscriptExportFilename,
  buildTranscriptExportPayload,
  formatTranscriptJson,
  formatTranscriptMarkdown,
} from '../src/droneHub/chat/transcript-export';
import type { TranscriptItem } from '../src/droneHub/types';

const sampleTurns: TranscriptItem[] = [
  {
    turn: 1,
    at: '2026-04-12T09:00:00.000Z',
    promptAt: '2026-04-12T09:00:00.000Z',
    startedAt: '2026-04-12T09:00:02.000Z',
    completedAt: '2026-04-12T09:00:05.000Z',
    id: 'turn-1',
    prompt: 'Review the current repo state.',
    attachments: [
      {
        name: 'screenshot.png',
        mime: 'image/png',
        size: 1536,
        relativePath: '.drone-hub/attachments/screenshot.png',
      },
    ],
    session: 'chat-default',
    logPath: '/tmp/chat.log',
    ok: true,
    output: 'Plan:\n- Check status\n- Report changes\n',
  },
  {
    turn: 2,
    at: '2026-04-12T09:05:00.000Z',
    prompt: 'Try again.',
    session: 'chat-default',
    logPath: '/tmp/chat.log',
    ok: false,
    error: '\u001b[31mfailed to connect\u001b[0m',
    output: '',
  },
];

describe('transcript export', () => {
  test('builds a structured JSON payload with explicit user and agent roles', () => {
    const payload = buildTranscriptExportPayload({
      droneId: 'drone-1',
      droneName: 'alpha',
      droneLabel: 'Alpha Drone',
      chatName: 'default',
      exportedAt: '2026-04-12T10:00:00.000Z',
      transcripts: sampleTurns,
    });

    expect(payload.format).toBe('drone-hub-transcript');
    expect(payload.drone.label).toBe('Alpha Drone');
    expect(payload.turns).toHaveLength(2);
    expect(payload.turns[0]?.user.role).toBe('user');
    expect(payload.turns[0]?.agent.role).toBe('agent');
    expect(payload.turns[0]?.startedAt).toBe('2026-04-12T09:00:02.000Z');
    expect(payload.turns[0]?.user.attachments[0]?.relativePath).toBe('.drone-hub/attachments/screenshot.png');
    expect(payload.turns[1]?.agent.status).toBe('error');
    expect(payload.turns[1]?.agent.text).toBe('failed to connect');
  });

  test('formats copy output as markdown with separate user and agent sections', () => {
    const markdown = formatTranscriptMarkdown({
      droneId: 'drone-1',
      droneName: 'alpha',
      droneLabel: 'Alpha Drone',
      chatName: 'default',
      exportedAt: '2026-04-12T10:00:00.000Z',
      transcripts: sampleTurns,
    });

    expect(markdown).toContain('# Drone Transcript');
    expect(markdown).toContain('- Drone: Alpha Drone');
    expect(markdown).toContain('## Turn 1');
    expect(markdown).toContain('- Started: 2026-04-12T09:00:02.000Z');
    expect(markdown).toContain('### User');
    expect(markdown).toContain('#### Attachments');
    expect(markdown).toContain('- screenshot.png (image/png, 1.50 KB, .drone-hub/attachments/screenshot.png)');
    expect(markdown).toContain('### Agent');
    expect(markdown).toContain('Plan:\n- Check status\n- Report changes');
    expect(markdown).toContain('### Agent Error');
    expect(markdown).toContain('failed to connect');
  });

  test('formats download output as pretty JSON', () => {
    const raw = formatTranscriptJson({
      droneId: 'drone-1',
      droneName: 'alpha',
      chatName: 'default',
      exportedAt: '2026-04-12T10:00:00.000Z',
      transcripts: sampleTurns,
    });
    const payload = JSON.parse(raw);

    expect(payload.turns).toHaveLength(2);
    expect(payload.turns[0]?.agent.status).toBe('ok');
    expect(payload.turns[1]?.agent.text).toBe('failed to connect');
  });

  test('builds a stable export filename from drone and chat names', () => {
    expect(
      buildTranscriptExportFilename({
        droneLabel: 'Alpha Drone',
        chatName: 'Design Review',
        exportedAt: '2026-04-12T10:00:00.000Z',
        extension: 'json',
      }),
    ).toBe('alpha-drone-design-review-transcript-2026-04-12T10-00-00.000Z.json');
  });
});
