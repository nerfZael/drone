import { describe, expect, test } from 'bun:test';
import { MESH_CHAT_PAYLOAD_BYTES } from '@drone/device-protocol';
import { boundedDroneChatPage } from '../src/hub/device-mesh/drone-chat-page';

describe('device mesh drone chat pages', () => {
  test('keeps the newest turns within budget and exposes an older cursor', () => {
    const turns = Array.from({ length: 100 }, (_, index) => ({
      id: `turn-${index + 1}`,
      turn: index + 1,
      prompt: `prompt ${index + 1}`,
      output: 'x'.repeat(40_000),
    }));
    const page = boundedDroneChatPage(turns);

    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MESH_CHAT_PAYLOAD_BYTES);
    expect(page.turns.at(-1)?.id).toBe('turn-100');
    expect(page.turns.every((turn) => turn.meshTruncated === true)).toBe(true);
    expect(page.page.hasOlder).toBe(true);
    expect(page.page.beforeCursor).toBeGreaterThan(0);

    const older = boundedDroneChatPage(turns, page.page.beforeCursor);
    expect(Number(older.turns.at(-1)?.turn)).toBeLessThan(Number(page.turns[0]?.turn));
  });
});
