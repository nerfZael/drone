import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { buildApp } from './app.js';

const originalEnv = {
  PORT: process.env.PORT,
  VOICE_STREAM_NEXT_API_PORT: process.env.VOICE_STREAM_NEXT_API_PORT,
  VOICE_STREAM_NEXT_DATA_DIR: process.env.VOICE_STREAM_NEXT_DATA_DIR,
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('app configuration', () => {
  afterEach(() => {
    restoreEnv();
  });

  test('uses PORT before the voice-specific API port', async () => {
    process.env.PORT = '43400';
    process.env.VOICE_STREAM_NEXT_API_PORT = '3299';
    process.env.VOICE_STREAM_NEXT_DATA_DIR = path.join(process.cwd(), 'server', 'data', 'tests', crypto.randomUUID());

    const built = await buildApp({ logger: false });
    try {
      expect(built.port).toBe(43400);
    } finally {
      await built.app.close();
      built.db.db.close();
    }
  });
});
