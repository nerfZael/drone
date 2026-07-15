import { describe, expect, test } from 'bun:test';
import { boundedAssistantHistory } from '../src/hub/device-mesh/features/cross-device-assistant/bounded-assistant-history';

describe('mesh assistant history', () => {
  test('keeps responses below the mesh message budget', () => {
    const history: any = boundedAssistantHistory({
      threadId: 'thread_1',
      sessionId: 'session_1',
      entries: Array.from({ length: 80 }, (_, index) => ({
        sequence: index + 1,
        id: `message_${index + 1}`,
        timestamp: new Date().toISOString(),
        message: {
          role: 'toolResult',
          content: 'x'.repeat(30_000),
          details: {
            target: { id: 'remote:desktop:main', label: 'Desktop', rootLabel: 'main' },
            meshRoute: {
              assistantHomeDeviceId: 'vps',
              targetDeviceId: 'desktop',
              rootId: 'main',
            },
          },
        },
      })),
      page: { limit: 100, beforeCursor: 1, hasOlder: true },
    });
    const serialized = JSON.stringify(history);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(180 * 1024);
    expect(serialized).toContain('desktop');
    expect((history as any).entries.at(-1).id).toBe('message_80');
  });

  test('honors a smaller caller budget when queue metadata shares the response', () => {
    const history: any = boundedAssistantHistory(
      {
        threadId: 'thread_1',
        entries: Array.from({ length: 60 }, (_, index) => ({
          id: `message_${index}`,
          message: { role: 'assistant', content: 'x'.repeat(12_000) },
        })),
      },
      64 * 1024,
    );
    expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThanOrEqual(64 * 1024);
    expect(history.entries.at(-1).id).toBe('message_59');
  });
});
