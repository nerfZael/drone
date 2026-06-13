import { describe, expect, test } from 'bun:test';

import { HubAssistantService } from '../src/hub/assistant';
import { updateRegistry } from '../src/host/registry';
import { withTempDroneDataDir } from './test-helpers';

const Type = {
  Object: (value: unknown) => value,
  String: (value?: unknown) => value,
  Optional: (value: unknown) => value,
  Number: (value?: unknown) => value,
  Boolean: (value?: unknown) => value,
  Array: (value: unknown) => value,
};

function sliceLines(content: string, startLine?: number, endLine?: number): { content: string; lineRange?: any } {
  if (startLine == null && endLine == null) return { content };
  const parts = content.split('\n');
  const lineCount = content ? (content.endsWith('\n') ? parts.length - 1 : parts.length) : 0;
  const lines = Array.from({ length: lineCount }, (_, index) => `${parts[index] ?? ''}${index < parts.length - 1 ? '\n' : ''}`);
  const start = startLine ?? 1;
  const end = Math.min(endLine ?? lines.length, lines.length);
  if (start > (endLine ?? lines.length)) throw new Error('startLine must be less than or equal to endLine');
  if (start > lines.length) throw new Error(`startLine exceeds file line count (${lines.length})`);
  const selected = lines.slice(start - 1, end);
  return {
    content: selected.join(''),
    lineRange: { startLine: start, endLine: end, totalLines: lines.length, returnedLines: selected.length },
  };
}

function seedDrones(): Promise<void> {
  const now = new Date().toISOString();
  return updateRegistry((reg: any) => {
    reg.drones = {
      'drone-a': {
        id: 'drone-a',
        name: 'Drone A',
        runtime: 'host',
        repoPath: '/tmp/drone-a',
        createdAt: now,
        chats: { default: { createdAt: now, turns: [] } },
      },
      'drone-b': {
        id: 'drone-b',
        name: 'Drone B',
        runtime: 'host',
        repoPath: '/tmp/drone-b',
        createdAt: now,
        chats: { default: { createdAt: now, turns: [] } },
      },
    };
  });
}

function makeFileService(files: Map<string, Map<string, string>>): HubAssistantService {
  const droneFiles = (droneId: string) => {
    const existing = files.get(droneId);
    if (existing) return existing;
    const next = new Map<string, string>();
    files.set(droneId, next);
    return next;
  };

  return new HubAssistantService({
    listDrones: async () => [
      { id: 'drone-a', name: 'Drone A', group: null, runtime: 'container', repoPath: '/tmp/drone-a', status: 'ready', chats: ['default'] },
      { id: 'drone-b', name: 'Drone B', group: null, runtime: 'host', repoPath: '/tmp/drone-b', status: 'ready', chats: ['default'] },
    ],
    createDrone: async () => {
      throw new Error('not implemented');
    },
    createChat: async () => {
      throw new Error('not implemented');
    },
    setDroneGroup: async () => {
      throw new Error('not implemented');
    },
    messageDrone: async () => {
      throw new Error('not implemented');
    },
    listDroneFiles: async ({ droneId, path }) => ({
      droneId,
      path: path || '.',
      relativePath: path || '.',
      entries: [...droneFiles(droneId).keys()].sort().map((filePath) => ({
        name: filePath.split('/').pop() || filePath,
        path: filePath,
        relativePath: filePath,
        kind: 'file' as const,
      })),
    }),
    readDroneFile: async ({ droneId, path, startLine, endLine }) => {
      const content = droneFiles(droneId).get(path);
      if (content == null) throw new Error(`file not found: ${path}`);
      if (path.endsWith('.bin')) throw new Error(`file is not text: ${path}`);
      const ranged = sliceLines(content, startLine, endLine);
      return {
        droneId,
        path,
        relativePath: path,
        kind: 'text' as const,
        content: ranged.content,
        size: Buffer.byteLength(content, 'utf8'),
        ...(ranged.lineRange ? { lineRange: ranged.lineRange } : {}),
      };
    },
    writeDroneFile: async ({ droneId, path, content }) => {
      droneFiles(droneId).set(path, content);
      return { droneId, path, relativePath: path, size: Buffer.byteLength(content, 'utf8') };
    },
    deleteDroneFile: async ({ droneId, path }) => {
      if (!droneFiles(droneId).delete(path)) throw new Error(`file not found: ${path}`);
      return { droneId, path, deleted: true };
    },
    moveDroneFile: async ({ droneId, fromPath, toPath }) => {
      const perDrone = droneFiles(droneId);
      const content = perDrone.get(fromPath);
      if (content == null) throw new Error(`file not found: ${fromPath}`);
      perDrone.delete(fromPath);
      perDrone.set(toPath, content);
      return { droneId, path: fromPath, movedTo: toPath };
    },
    searchDroneFiles: async ({ droneId, query, limit = 20, contextBefore = 0, contextAfter = 0 }) => {
      const allMatches = [...droneFiles(droneId).entries()].flatMap(([path, content]) =>
        content.split('\n').flatMap((line, index) => (line.includes(query) ? [{ path, line: index + 1, text: line, content }] : [])),
      );
      const matches = allMatches
        .slice(0, limit)
        .map(({ path, line, text, content }) => {
          if (!contextBefore && !contextAfter) return { path, relativePath: path, line, text };
          const lines = content.split('\n');
          const start = Math.max(1, line - contextBefore);
          const end = Math.min(lines.length, line + contextAfter);
          return {
            path,
            relativePath: path,
            line,
            text,
            context: Array.from({ length: end - start + 1 }, (_, index) => {
              const current = start + index;
              return {
                line: current,
                kind: current < line ? 'before' as const : current > line ? 'after' as const : 'match' as const,
                text: lines[current - 1] ?? '',
              };
            }),
          };
        });
      return {
        droneId,
        path: '.',
        relativePath: '.',
        query,
        limit,
        ...(contextBefore || contextAfter ? { contextBefore, contextAfter } : {}),
        caps: { limit, maxContextBefore: 10, maxContextAfter: 10 },
        truncated: allMatches.length > limit,
        matches,
      };
    },
    findDroneFiles: async ({ droneId, pattern = '*', limit = 100 }) => {
      const needle = pattern.replace(/\*/g, '');
      const allMatches = [...droneFiles(droneId).keys()].filter((filePath) => pattern === '*' || filePath.includes(needle));
      return {
        droneId,
        path: '.',
        relativePath: '.',
        pattern,
        limit,
        truncated: allMatches.length > limit,
        matches: allMatches.slice(0, limit).map((filePath) => ({
          name: filePath.split('/').pop() || filePath,
          path: filePath,
          relativePath: filePath,
          kind: 'file' as const,
        })),
      };
    },
    statDronePath: async ({ droneId, path }) => {
      if (path === 'dir') return { droneId, path, exists: true, kind: 'directory' as const };
      const content = droneFiles(droneId).get(path);
      return content == null
        ? { droneId, path, exists: false }
        : { droneId, path, exists: true, kind: 'file' as const, size: Buffer.byteLength(content, 'utf8') };
    },
    runDroneBash: async ({ droneId, command, cwd, timeoutMs }) => ({
      ok: true as const,
      droneId,
      cwd: cwd || '.',
      command,
      code: command.includes('fail') ? 1 : 0,
      stdout: `ran: ${command}\n`,
      stderr: '',
      timeoutMs: timeoutMs ?? 30_000,
      timedOut: false,
    }),
    listDroneChangedFiles: async ({ droneId }) => ({
      droneId,
      repoRoot: '/work/repo',
      files: [
        {
          path: '/work/repo/src/changed.ts',
          relativePath: 'src/changed.ts',
          status: 'modified',
          staged: true,
          unstaged: true,
          untracked: false,
          conflicted: false,
          stagedStatus: 'modified',
          unstagedStatus: 'modified',
          stagedChar: 'M',
          unstagedChar: 'M',
        },
        {
          path: '/work/repo/src/new.ts',
          relativePath: 'src/new.ts',
          status: 'untracked',
          staged: false,
          unstaged: true,
          untracked: true,
          conflicted: false,
          stagedStatus: null,
          unstagedStatus: 'untracked',
          stagedChar: '.',
          unstagedChar: '?',
        },
      ],
      counts: { changed: 2, staged: 1, unstaged: 2, untracked: 1, conflicted: 0 },
      limit: 200,
      truncated: false,
    }),
  });
}

async function buildAssistantFileTools(service: HubAssistantService): Promise<{ threadId: string; tools: any[] }> {
  const snapshot = await service.createThread({ title: 'files', provider: 'openai', model: 'gpt-5.5' });
  await service.updateAccessScope({ threadId: snapshot.activeThreadId, readMode: 'all', writeMode: 'all', droneIds: [] });
  return {
    threadId: snapshot.activeThreadId,
    tools: (service as any).buildTools({ Type }, snapshot.activeThreadId),
  };
}

describe('assistant drone file tools', () => {
  test('enforces read and write scope before touching drone files', async () => {
    await withTempDroneDataDir('assistant-drone-file-scope-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        ['drone-a', new Map([['README.md', 'allowed\n']])],
        ['drone-b', new Map([['README.md', 'blocked\n']])],
      ]);
      const service = makeFileService(files);
      const { threadId, tools } = await buildAssistantFileTools(service);
      await service.updateAccessScope({
        threadId,
        readMode: 'selected',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      const readFile = tools.find((tool) => tool.name === 'read_file');
      const findFiles = tools.find((tool) => tool.name === 'find_files');
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');
      const bash = tools.find((tool) => tool.name === 'bash');
      const listChangedFiles = tools.find((tool) => tool.name === 'list_changed_files');

      await expect(readFile.execute('read-b', { droneId: 'drone-b', path: 'README.md' })).rejects.toThrow(
        'assistant scope does not include drone',
      );
      await expect(findFiles.execute('find-b', { droneId: 'drone-b', pattern: '*.md' })).rejects.toThrow(
        'assistant scope does not include drone',
      );
      await expect(
        applyPatch.execute('patch-b', {
          droneId: 'drone-b',
          patch: ['*** Begin Patch', '*** Update File: README.md', '@@', '-blocked', '+changed', '*** End Patch'].join('\n'),
        }),
      ).rejects.toThrow('assistant scope does not include drone');
      await expect(bash.execute('bash-b', { droneId: 'drone-b', command: 'pwd' })).rejects.toThrow(
        'assistant scope does not include drone',
      );
      await expect(listChangedFiles.execute('changed-b', { droneId: 'drone-b' })).rejects.toThrow(
        'assistant scope does not include drone',
      );

      expect(files.get('drone-b')?.get('README.md')).toBe('blocked\n');
    });
  });

  test('lists changed files as a read-only review helper', async () => {
    await withTempDroneDataDir('assistant-drone-changed-files-', async () => {
      await seedDrones();
      const service = makeFileService(new Map());
      const { tools } = await buildAssistantFileTools(service);
      const listChangedFiles = tools.find((tool) => tool.name === 'list_changed_files');

      const result = await listChangedFiles.execute('changed-a', { droneId: 'drone-a' });

      expect(result.details).toMatchObject({
        droneId: 'drone-a',
        repoRoot: '/work/repo',
        counts: { changed: 2, staged: 1, unstaged: 2, untracked: 1, conflicted: 0 },
        limit: 200,
        truncated: false,
        files: [
          {
            path: '/work/repo/src/changed.ts',
            relativePath: 'src/changed.ts',
            status: 'modified',
            staged: true,
            unstaged: true,
          },
          {
            path: '/work/repo/src/new.ts',
            relativePath: 'src/new.ts',
            status: 'untracked',
            untracked: true,
          },
        ],
      });
    });
  });

  test('runs bash through the drone bash callback with write scope', async () => {
    await withTempDroneDataDir('assistant-drone-bash-', async () => {
      await seedDrones();
      const service = makeFileService(new Map());
      const { threadId, tools } = await buildAssistantFileTools(service);
      await service.updateAccessScope({
        threadId,
        readMode: 'all',
        writeMode: 'selected',
        droneIds: ['drone-a'],
      });

      const bash = tools.find((tool) => tool.name === 'bash');
      const result = await bash.execute('bash-a', {
        droneId: 'drone-a',
        command: 'bun test',
        cwd: 'apps/drone',
        timeoutMs: 999_999,
      });

      expect(result.details).toMatchObject({
        ok: true,
        droneId: 'drone-a',
        cwd: 'apps/drone',
        command: 'bun test',
        code: 0,
        stdout: 'ran: bun test\n',
        timeoutMs: 120_000,
        timedOut: false,
      });
    });
  });

  test('reads an inclusive line range from a drone file', async () => {
    await withTempDroneDataDir('assistant-drone-file-range-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        ['drone-a', new Map([['src/example.ts', ['one', 'two', 'three', 'four'].join('\n')]])],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const readFile = tools.find((tool) => tool.name === 'read_file');

      const result = await readFile.execute('read-range', {
        droneId: 'drone-a',
        path: 'src/example.ts',
        startLine: 2,
        endLine: 3,
      });

      expect(result.content[0].text).toBe('# src/example.ts lines 2-3 of 4 (2 returned)\n\ntwo\nthree\n');
      expect(result.details).toMatchObject({
        droneId: 'drone-a',
        path: 'src/example.ts',
        relativePath: 'src/example.ts',
        content: 'two\nthree\n',
        lineRange: {
          startLine: 2,
          endLine: 3,
          totalLines: 4,
          returnedLines: 2,
        },
      });
    });
  });

  test('rejects invalid read line ranges', async () => {
    await withTempDroneDataDir('assistant-drone-file-invalid-range-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([['drone-a', new Map([['src/example.ts', 'one\ntwo\n']])]]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const readFile = tools.find((tool) => tool.name === 'read_file');

      await expect(
        readFile.execute('read-invalid-range', {
          droneId: 'drone-a',
          path: 'src/example.ts',
          startLine: 3,
          endLine: 2,
        }),
      ).rejects.toThrow('startLine must be less than or equal to endLine');
      await expect(
        readFile.execute('read-invalid-range-negative', {
          droneId: 'drone-a',
          path: 'src/example.ts',
          startLine: 0,
        }),
      ).rejects.toThrow('startLine must be a positive integer');
    });
  });

  test('returns structured search context lines when requested', async () => {
    await withTempDroneDataDir('assistant-drone-search-context-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        ['drone-a', new Map([['src/example.ts', ['before', 'target match', 'after', 'later target'].join('\n')]])],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const searchFiles = tools.find((tool) => tool.name === 'search_files');

      const result = await searchFiles.execute('search-context', {
        droneId: 'drone-a',
        query: 'target',
        contextBefore: 1,
        contextAfter: 1,
        limit: 1,
      });

      expect(result.details).toMatchObject({
        droneId: 'drone-a',
        query: 'target',
        limit: 1,
        contextBefore: 1,
        contextAfter: 1,
        caps: { limit: 1, maxContextBefore: 10, maxContextAfter: 10 },
        truncated: true,
        matches: [
          {
            path: 'src/example.ts',
            relativePath: 'src/example.ts',
            line: 2,
            text: 'target match',
            context: [
              { line: 1, kind: 'before', text: 'before' },
              { line: 2, kind: 'match', text: 'target match' },
              { line: 3, kind: 'after', text: 'after' },
            ],
          },
        ],
      });
    });
  });

  test('includes relativePath in list find and default search results', async () => {
    await withTempDroneDataDir('assistant-drone-relative-paths-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([['drone-a', new Map([['src/example.ts', 'target\n']])]]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const listFiles = tools.find((tool) => tool.name === 'list_files');
      const findFiles = tools.find((tool) => tool.name === 'find_files');
      const searchFiles = tools.find((tool) => tool.name === 'search_files');

      const listed = await listFiles.execute('list-relative', { droneId: 'drone-a' });
      const found = await findFiles.execute('find-relative', { droneId: 'drone-a', pattern: '*.ts' });
      const searched = await searchFiles.execute('search-relative', { droneId: 'drone-a', query: 'target' });

      expect(listed.details).toMatchObject({ path: '.', relativePath: '.' });
      expect(found.details).toMatchObject({ path: '.', relativePath: '.', truncated: false });
      expect(searched.details).toMatchObject({ path: '.', relativePath: '.', truncated: false });
      expect(listed.details.entries[0]).toMatchObject({ path: 'src/example.ts', relativePath: 'src/example.ts' });
      expect(found.details.matches[0]).toMatchObject({ path: 'src/example.ts', relativePath: 'src/example.ts' });
      expect(searched.details.matches[0]).toMatchObject({ path: 'src/example.ts', relativePath: 'src/example.ts' });
    });
  });

  test('requests approval before running bash', async () => {
    await withTempDroneDataDir('assistant-drone-bash-approval-', async () => {
      await seedDrones();
      const service = makeFileService(new Map());
      const snapshot = await service.createThread({ title: 'bash approval', provider: 'openai', model: 'gpt-5.5' });
      const threadId = snapshot.activeThreadId;
      await service.updateAccessScope({ threadId, readMode: 'all', writeMode: 'all', droneIds: [] });
      const approvals: any[] = [];

      const beforeToolCall = (service as any).beforeToolCall(
        threadId,
        {
          toolCall: { id: 'call-bash', name: 'bash' },
          args: { droneId: 'drone-a', command: 'bun test', cwd: 'apps/drone', timeoutMs: 999_999 },
        },
        async (event: any) => {
          if (event.type !== 'approval_pending') return;
          approvals.push(event.approval);
          await service.approve(event.approval.id, true);
        },
      );

      await expect(beforeToolCall).resolves.toBeUndefined();
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({
        threadId,
        toolCallId: 'call-bash',
        toolName: 'bash',
        label: 'Run bash in drone',
        args: {
          resolved: {
            droneId: 'drone-a',
            droneName: 'Drone A',
            command: 'bun test',
            cwd: 'apps/drone',
            timeoutMs: 120_000,
          },
        },
      });
    });
  });

  test('blocks host-runtime bash before requesting approval', async () => {
    await withTempDroneDataDir('assistant-drone-bash-host-block-', async () => {
      await seedDrones();
      const service = makeFileService(new Map());
      const snapshot = await service.createThread({ title: 'bash host block', provider: 'openai', model: 'gpt-5.5' });
      const threadId = snapshot.activeThreadId;
      await service.updateAccessScope({
        threadId,
        readMode: 'all',
        writeMode: 'selected',
        droneIds: ['drone-b'],
      });
      const approvals: any[] = [];

      const result = await (service as any).beforeToolCall(
        threadId,
        {
          toolCall: { id: 'call-bash-host', name: 'bash' },
          args: { droneId: 'drone-b', command: 'pwd' },
        },
        async (event: any) => {
          if (event.type === 'approval_pending') approvals.push(event.approval);
        },
      );

      expect(result).toEqual({ block: true, reason: 'bash is only supported for container drones: Drone B' });
      expect(approvals).toHaveLength(0);
    });
  });

  test('applies add update delete and move patch operations in one call', async () => {
    await withTempDroneDataDir('assistant-drone-file-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        [
          'drone-a',
          new Map([
            ['src/a.ts', 'export const value = 1;\n'],
            ['src/old.ts', 'remove me\n'],
            ['src/move.ts', 'old\n'],
          ]),
        ],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      const result = await applyPatch.execute('patch-a', {
        droneId: 'drone-a',
        patch: [
          '*** Begin Patch',
          '*** Update File: src/a.ts',
          '@@',
          '-export const value = 1;',
          '+export const value = 2;',
          '*** Add File: src/b.ts',
          '+hello',
          '*** Delete File: src/old.ts',
          '*** Update File: src/move.ts',
          '*** Move to: src/moved.ts',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      });

      const droneAFiles = files.get('drone-a');
      expect(result.details.operations.map((operation: any) => operation.kind)).toEqual(['update', 'add', 'delete', 'update']);
      expect(droneAFiles?.get('src/a.ts')).toBe('export const value = 2;\n');
      expect(droneAFiles?.get('src/b.ts')).toBe('hello\n');
      expect(droneAFiles?.has('src/old.ts')).toBe(false);
      expect(droneAFiles?.has('src/move.ts')).toBe(false);
      expect(droneAFiles?.get('src/moved.ts')).toBe('new\n');
    });
  });

  test('rejects ambiguous patch context', async () => {
    await withTempDroneDataDir('assistant-drone-file-ambiguous-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([['drone-a', new Map([['dupe.txt', 'x\nx\n']])]]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await expect(
        applyPatch.execute('patch-dupe', {
          droneId: 'drone-a',
          patch: ['*** Begin Patch', '*** Update File: dupe.txt', '@@', '-x', '+y', '*** End Patch'].join('\n'),
        }),
      ).rejects.toThrow('ambiguous');

      expect(files.get('drone-a')?.get('dupe.txt')).toBe('x\nx\n');
    });
  });

  test('does not partially apply a patch when a later operation fails', async () => {
    await withTempDroneDataDir('assistant-drone-file-atomic-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        [
          'drone-a',
          new Map([
            ['ok.txt', 'one\n'],
            ['dupe.txt', 'x\nx\n'],
          ]),
        ],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await expect(
        applyPatch.execute('patch-partial', {
          droneId: 'drone-a',
          patch: [
            '*** Begin Patch',
            '*** Update File: ok.txt',
            '@@',
            '-one',
            '+two',
            '*** Update File: dupe.txt',
            '@@',
            '-x',
            '+y',
            '*** End Patch',
          ].join('\n'),
        }),
      ).rejects.toThrow('ambiguous');

      expect(files.get('drone-a')?.get('ok.txt')).toBe('one\n');
      expect(files.get('drone-a')?.get('dupe.txt')).toBe('x\nx\n');
    });
  });

  test('rejects add and move targets that already exist', async () => {
    await withTempDroneDataDir('assistant-drone-file-collision-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        [
          'drone-a',
          new Map([
            ['existing.txt', 'keep\n'],
            ['source.txt', 'source\n'],
          ]),
        ],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await expect(
        applyPatch.execute('patch-add-existing', {
          droneId: 'drone-a',
          patch: ['*** Begin Patch', '*** Add File: existing.txt', '+replace', '*** End Patch'].join('\n'),
        }),
      ).rejects.toThrow('already exists');
      await expect(
        applyPatch.execute('patch-move-existing', {
          droneId: 'drone-a',
          patch: [
            '*** Begin Patch',
            '*** Update File: source.txt',
            '*** Move to: existing.txt',
            '@@',
            '-source',
            '+moved',
            '*** End Patch',
          ].join('\n'),
        }),
      ).rejects.toThrow('already exists');

      expect(files.get('drone-a')?.get('existing.txt')).toBe('keep\n');
      expect(files.get('drone-a')?.get('source.txt')).toBe('source\n');
    });
  });

  test('deletes and move-only patches do not require reading file text', async () => {
    await withTempDroneDataDir('assistant-drone-file-binary-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([
        [
          'drone-a',
          new Map([
            ['delete.bin', '\0delete'],
            ['move.bin', '\0move'],
          ]),
        ],
      ]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await applyPatch.execute('patch-binary-delete-move', {
        droneId: 'drone-a',
        patch: [
          '*** Begin Patch',
          '*** Delete File: delete.bin',
          '*** Update File: move.bin',
          '*** Move to: moved.bin',
          '*** End Patch',
        ].join('\n'),
      });

      expect(files.get('drone-a')?.has('delete.bin')).toBe(false);
      expect(files.get('drone-a')?.has('move.bin')).toBe(false);
      expect(files.get('drone-a')?.get('moved.bin')).toBe('\0move');
    });
  });

  test('moves original file before writing a replacement at the source path', async () => {
    await withTempDroneDataDir('assistant-drone-file-move-readd-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([['drone-a', new Map([['source.bin', '\0original']])]]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await applyPatch.execute('patch-move-readd', {
        droneId: 'drone-a',
        patch: [
          '*** Begin Patch',
          '*** Update File: source.bin',
          '*** Move to: moved.bin',
          '*** Add File: source.bin',
          '+replacement',
          '*** End Patch',
        ].join('\n'),
      });

      expect(files.get('drone-a')?.get('moved.bin')).toBe('\0original');
      expect(files.get('drone-a')?.get('source.bin')).toBe('replacement\n');
    });
  });

  test('rejects directory delete or move during preflight without partial writes', async () => {
    await withTempDroneDataDir('assistant-drone-file-directory-patch-', async () => {
      await seedDrones();
      const files = new Map<string, Map<string, string>>([['drone-a', new Map([['ok.txt', 'one\n']])]]);
      const service = makeFileService(files);
      const { tools } = await buildAssistantFileTools(service);
      const applyPatch = tools.find((tool) => tool.name === 'apply_patch');

      await expect(
        applyPatch.execute('patch-delete-dir', {
          droneId: 'drone-a',
          patch: [
            '*** Begin Patch',
            '*** Update File: ok.txt',
            '@@',
            '-one',
            '+two',
            '*** Delete File: dir',
            '*** End Patch',
          ].join('\n'),
        }),
      ).rejects.toThrow('directory');
      await expect(
        applyPatch.execute('patch-move-dir', {
          droneId: 'drone-a',
          patch: ['*** Begin Patch', '*** Update File: dir', '*** Move to: moved-dir', '*** End Patch'].join('\n'),
        }),
      ).rejects.toThrow('directory');

      expect(files.get('drone-a')?.get('ok.txt')).toBe('one\n');
    });
  });
});
