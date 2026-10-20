import crypto from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { applyPatchHunks, parsePatch } from '@blip/tools';

import { HubAssistantService } from '../src/hub/assistant';
import { FileReadGuard } from '../src/hub/assistant/file-read-guard';
import { withTempDroneDataDir } from './test-helpers';

const sha = (text: string) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
const BINARY = '\u0000binary';

/**
 * Files in memory behind the file callbacks the Hub's executor uses. Every workspace (`box`, `folder`) leads to the same
 * files, as a repository and a folder added inside it lead to the same host files.
 */
function workspace(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  const service = new HubAssistantService({
    listDrones: async () => [],
    readDroneFile: async ({ droneId, path, startLine, endLine }) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`file not found: ${path}`);
      const lines = content.split('\n');
      const part = startLine ? lines.slice(startLine - 1, endLine ?? lines.length).join('\n') : content;
      return { droneId, path, kind: 'text', content: part, sha256: sha(content), fileId: `host:${path}` };
    },
    droneFileVersion: async ({ path }) => {
      const content = files.get(path);
      const fileId = `host:${path}`;
      if (content === undefined) return { path, fileId, state: 'missing' };
      if (content.startsWith('\u0000')) return { path, fileId, state: 'unreadable' };
      return { path, fileId, state: 'file', sha256: sha(content) };
    },
    locateDroneFile: async ({ path }) => ({ fileId: `host:${path}` }),
    writeDroneFile: async ({ droneId, path, content }) => {
      // Slow enough for two writes to overlap if nothing kept them apart.
      await new Promise((resolve) => setTimeout(resolve, 5));
      files.set(path, content);
      return { droneId, path, size: content.length };
    },
    deleteDroneFile: async ({ droneId, path }) => {
      files.delete(path);
      return { droneId, path };
    },
    moveDronePath: async ({ droneId, fromPath, toPath }) => {
      files.set(toPath, files.get(fromPath)!);
      files.delete(fromPath);
      return { droneId, path: fromPath, movedTo: toPath };
    },
    statDronePath: async ({ droneId, path }) =>
      files.has(path) ? { droneId, path, exists: true, kind: 'file' } : { droneId, path, exists: false },
    batchDroneFiles: async ({ operations }) => {
      for (const operation of operations as any[]) {
        if (operation.type === 'write') files.set(operation.path, operation.content);
        else if (operation.type === 'delete') files.delete(operation.path);
        else if (operation.type === 'move') {
          files.set(operation.toPath, files.get(operation.fromPath)!);
          files.delete(operation.fromPath);
        }
      }
      return { ok: true } as any;
    },
  } as any);
  const call = (reader: string | undefined, tool: string, args: Record<string, unknown>, through = 'box') =>
    service.executeAuthorizedWorkspaceTool(through, { tool, args, ...(reader ? { reader } : {}) }, async () => {}, {
      parse: parsePatch,
      applyHunks: applyPatchHunks,
    });
  return { files, call };
}

const NOT_READ = 'Read notes.md with read_file before changing it';
const CHANGED = 'notes.md changed since you last read it';

describe('chats change shared files only as they last read them', () => {
  test('a chat must read a file before changing it; any part of it counts', async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { files, call } = workspace({ 'notes.md': 'one\ntwo\nthree' });
      await expect(call('chat:a', 'write_file', { path: 'notes.md', content: 'x' })).rejects.toThrow(NOT_READ);
      await call('chat:a', 'read_file', { path: 'notes.md', startLine: 2, endLine: 2 });
      await call('chat:a', 'write_file', { path: 'notes.md', content: 'by a' });
      expect(files.get('notes.md')).toBe('by a');
      // Having written it, the chat has the latest and goes on without reading again.
      await call('chat:a', 'write_file', { path: 'notes.md', content: 'by a again' });
      expect(files.get('notes.md')).toBe('by a again');
    });
  });

  test("a chat that read an older version is refused until it reads the other chat's change", async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { files, call } = workspace({ 'notes.md': 'v1' });
      await call('chat:a', 'read_file', { path: 'notes.md' });
      await call('chat:b', 'read_file', { path: 'notes.md' });
      await call('chat:a', 'write_file', { path: 'notes.md', content: 'v2 by a' });
      await expect(call('chat:b', 'write_file', { path: 'notes.md', content: 'v2 by b' })).rejects.toThrow(CHANGED);
      expect(files.get('notes.md')).toBe('v2 by a');
      await call('chat:b', 'read_file', { path: 'notes.md' });
      await call('chat:b', 'write_file', { path: 'notes.md', content: 'v3 by b' });
      expect(files.get('notes.md')).toBe('v3 by b');
    });
  });

  test('a change made outside the tools (the editor, a command) counts as well', async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { files, call } = workspace({ 'notes.md': 'v1' });
      await call('chat:a', 'read_file', { path: 'notes.md' });
      files.set('notes.md', 'saved in the editor');
      await expect(call('chat:a', 'write_file', { path: 'notes.md', content: 'x' })).rejects.toThrow(CHANGED);
    });
  });

  test('new files can always be made; changing one another chat made means reading it', async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { call } = workspace({});
      await call('chat:a', 'write_file', { path: 'notes.md', content: 'new' });
      await call('chat:a', 'apply_patch', { patch: '*** Begin Patch\n*** Add File: other.md\n+hello\n*** End Patch' });
      await expect(call('chat:b', 'write_file', { path: 'notes.md', content: 'x' })).rejects.toThrow(NOT_READ);
    });
  });

  test('patches and deletes are checked; a move only where it replaces a file', async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { files, call } = workspace({ 'notes.md': 'one\ntwo', 'kept.md': 'kept' });
      const patch = '*** Begin Patch\n*** Update File: notes.md\n@@\n one\n-two\n+TWO\n*** End Patch';
      await expect(call('chat:a', 'apply_patch', { patch })).rejects.toThrow(NOT_READ);
      await expect(call('chat:a', 'delete_file', { path: 'notes.md' })).rejects.toThrow(NOT_READ);
      await call('chat:a', 'read_file', { path: 'notes.md' });
      await call('chat:a', 'apply_patch', { patch });
      expect(files.get('notes.md')).toBe('one\nTWO');
      // A move keeps the content, so it needs no read; replacing a file does.
      await call('chat:b', 'move_path', { from: 'kept.md', to: 'moved.md' });
      await expect(call('chat:b', 'move_path', { from: 'moved.md', to: 'notes.md', overwrite: true })).rejects.toThrow(NOT_READ);
      // The patching chat saw what it wrote, so it can delete without reading again.
      await call('chat:a', 'delete_file', { path: 'notes.md' });
      expect(files.has('notes.md')).toBe(false);
    });
  });

  test('files read_file cannot show, and calls made for no chat, are not checked', async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { files, call } = workspace({ 'image.bin': BINARY, 'notes.md': 'v1' });
      await call('chat:a', 'write_file', { path: 'image.bin', content: 'replaced' });
      await call(undefined, 'write_file', { path: 'notes.md', content: 'by the hub' });
      expect(files.get('image.bin')).toBe('replaced');
      expect(files.get('notes.md')).toBe('by the hub');
    });
  });

  test('a file reached through two workspaces is one file: read through one, written through the other', async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { files, call } = workspace({ 'notes.md': 'v1' });
      await call('chat:a', 'read_file', { path: 'notes.md' }, 'box');
      await call('chat:a', 'write_file', { path: 'notes.md', content: 'by a' }, 'folder');
      expect(files.get('notes.md')).toBe('by a');
    });
  });

  test('of two chats writing one file they both read, only the first gets through, whichever workspace they use', async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { files, call } = workspace({ 'notes.md': 'v1' });
      // Each works through its own workspace, so only holding the file itself keeps them apart.
      await call('chat:a', 'read_file', { path: 'notes.md' }, 'box');
      await call('chat:b', 'read_file', { path: 'notes.md' }, 'folder');
      const results = await Promise.allSettled([
        call('chat:a', 'write_file', { path: 'notes.md', content: 'by a' }, 'box'),
        call('chat:b', 'write_file', { path: 'notes.md', content: 'by b' }, 'folder'),
      ]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect(files.get('notes.md')).toBe('by a');
    });
  });

  test('of two chats writing one file they both read, only the first gets through', async () => {
    await withTempDroneDataDir('read-guard-', async () => {
      const { files, call } = workspace({ 'notes.md': 'v1' });
      await call('chat:a', 'read_file', { path: 'notes.md' });
      await call('chat:b', 'read_file', { path: 'notes.md' });
      const results = await Promise.allSettled([
        call('chat:a', 'write_file', { path: 'notes.md', content: 'by a' }),
        call('chat:b', 'write_file', { path: 'notes.md', content: 'by b' }),
      ]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
      expect(String((results[1] as PromiseRejectedResult).reason?.message)).toContain(CHANGED);
      expect(files.get('notes.md')).toBe('by a');
    });
  });
});

describe('the read guard', () => {
  test('forgets the oldest files and readers past its limits', () => {
    const guard = new FileReadGuard(2, 2);
    guard.saw('a', 'f1', 'x');
    guard.saw('a', 'f2', 'x');
    guard.saw('a', 'f3', 'x');
    expect(() => guard.assertCurrent('a', 'f1', 'x', 'f1')).toThrow('Read f1');
    guard.assertCurrent('a', 'f3', 'x', 'f3');
    guard.saw('b', 'f1', 'x');
    guard.saw('c', 'f1', 'x');
    // Reader a was the least recently active.
    expect(() => guard.assertCurrent('a', 'f3', 'x', 'f3')).toThrow('Read f3');
    guard.assertCurrent('c', 'f1', 'x', 'f1');
  });
});
