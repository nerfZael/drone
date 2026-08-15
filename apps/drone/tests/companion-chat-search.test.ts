import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'bun:test';

import { resetHubDatabaseForTests } from '../src/host/hub-database';
import { resetDroneRootDirForTests } from '../src/host/paths';
import {
  archiveChatInStore,
  searchActiveChatMessages,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
} from '../src/hub/transcript-store';

test('Companion keyword search indexes visible active-chat text and drops archived chats', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drone-companion-search-'));
  const previous = process.env.DRONE_DATA_DIR;
  process.env.DRONE_DATA_DIR = path.join(root, 'data');
  resetDroneRootDirForTests();
  try {
    await upsertChatInStore({
      droneId: 'search-drone',
      chatName: 'default',
      chatEntry: { id: 'search-chat', createdAt: '2026-08-15T10:00:00.000Z' },
    });
    await upsertTranscriptTurnInStore({
      droneId: 'search-drone',
      chatName: 'default',
      turn: {
        id: 'turn-1',
        at: '2026-08-15T10:00:00.000Z',
        prompt: 'Find the cobalt deployment note',
        ok: true,
        output: 'The cobalt deployment is ready.',
      },
    });

    const active = searchActiveChatMessages({ query: 'cobalt deployment' });
    expect(active.results.length).toBe(2);
    expect(active.results.map((result) => result.role).sort()).toEqual(['assistant', 'user']);

    await archiveChatInStore({
      droneId: 'search-drone',
      chatName: 'default',
      archivedAt: '2026-08-15T11:00:00.000Z',
      deleteAt: '2026-09-15T11:00:00.000Z',
      archiveRetention: '30d',
    });
    expect(searchActiveChatMessages({ query: 'cobalt deployment' }).results).toEqual([]);
  } finally {
    await resetHubDatabaseForTests();
    if (previous == null) delete process.env.DRONE_DATA_DIR;
    else process.env.DRONE_DATA_DIR = previous;
    resetDroneRootDirForTests();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
