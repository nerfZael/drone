import { expect, test } from 'bun:test';
import {
  latestExternalCheckpointId,
  latestNativeCheckpointId,
} from '../src/droneHub/app/side-chat-checkpoint-model';

test('captures the last completed external answer, excluding trailing steering and failures', () => {
  expect(
    latestExternalCheckpointId([
      { id: 'answer', ok: true, output: 'done' },
      { id: 'steer', ok: true, output: '', userOnly: true },
      { id: 'partial', ok: false, output: 'working' },
    ] as any),
  ).toBe('answer');
  expect(latestExternalCheckpointId(null)).toBe('');
});

test('native checkpoints exclude tool requests, partial reasoning, and later user inputs', () => {
  expect(
    latestNativeCheckpointId([
      {
        id: 'answer',
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'done' }],
      },
      { id: 'user', role: 'user', content: 'next' },
      {
        id: 'tool',
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'checking' }, { type: 'toolCall' }],
      },
      { id: 'thinking', role: 'assistant', content: [{ type: 'thinking', thinking: 'working' }] },
    ]),
  ).toBe('answer');
});
