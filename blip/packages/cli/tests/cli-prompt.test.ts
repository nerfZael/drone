import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assembleCliSystemPrompt } from '../src/cli-prompt';

describe('Blip CLI prompt policy', () => {
  test('the CLI explicitly opts into root AGENTS.md instructions', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'blip-cli-prompt-'));
    await writeFile(path.join(workspaceRoot, 'AGENTS.md'), 'CLI workspace instruction');
    const prompt = await assembleCliSystemPrompt({
      workspaceRoot,
      toolProfile: 'read-only',
    });
    expect(prompt).toContain('Repository instructions from AGENTS.md:');
    expect(prompt).toContain('CLI workspace instruction');
  });
});
