import { afterEach, describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { DaemonHttpError, handleDaemonWorkspaceRequest } from '../src/daemon-workspace';
import { handleDaemonManagedStateRequest } from '../src/daemon-managed-state';
import { managedDroneStateFingerprint } from '../src/managed-drone-state';
import {
  DroneApiRequestError,
  managedDroneSync,
  workspaceBatch,
  workspaceExec,
  workspaceGitHashes,
  workspaceReadChunk,
  workspaceReadFile,
  workspaceWriteChunk,
  workspaceWriteFile,
  type DroneClient,
} from '../src/host/api';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

async function startWorkspaceServer(): Promise<{ client: DroneClient; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-workspace-api-'));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const request = {
        req,
        res,
        method: String(req.method ?? 'GET').toUpperCase(),
        pathname: url.pathname,
      };
      if (await handleDaemonManagedStateRequest({ ...request, dataDir: root })) return;
      const handled = await handleDaemonWorkspaceRequest({
        ...request,
        url,
      });
      if (!handled) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      }
    } catch (error: any) {
      res.statusCode = error instanceof DaemonHttpError ? error.statusCode : 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: error?.message ?? String(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind TCP');
  cleanup.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    client: { baseUrl: `http://127.0.0.1:${address.port}`, token: 'unused-test-token' },
    root,
  };
}

describe('drone daemon workspace API', () => {
  test('applies managed drone state in one request and skips an unchanged fingerprint', async () => {
    const { client, root } = await startWorkspaceServer();
    const skillRoot = path.join(root, '.agents', 'skills');
    const mcpPath = path.join(root, '.cursor', 'mcp.json');
    const agentsPath = path.join(root, 'repo', 'AGENTS.md');
    await fs.mkdir(path.join(skillRoot, 'retired'), { recursive: true });
    await fs.writeFile(path.join(skillRoot, 'retired', 'SKILL.md'), 'retired');
    await fs.writeFile(
      path.join(skillRoot, '.drone-managed-skills.json'),
      JSON.stringify({ managedSlugs: ['retired'] }),
    );
    await fs.mkdir(path.dirname(mcpPath), { recursive: true });
    await fs.writeFile(
      mcpPath,
      JSON.stringify({ mcpServers: { unmanaged: { command: 'keep-me' } } }),
    );

    const unsignedPayload = {
      version: 1 as const,
      skillTargets: [
        {
          rootPath: skillRoot,
          packages: [
            {
              slug: 'example',
              files: [{ path: 'SKILL.md', content: '# Example\n', executable: false }],
            },
          ],
        },
      ],
      mcpTargets: [
        {
          configPath: mcpPath,
          projection: {
            format: 'json' as const,
            managedNames: ['drone-hub'],
            rootKey: 'mcpServers' as const,
            entries: { 'drone-hub': { url: 'http://host.docker.internal/mcp' } },
          },
        },
      ],
      agentsFile: { path: agentsPath, content: '# Managed instructions\n' },
    };
    const payload = {
      ...unsignedPayload,
      fingerprint: managedDroneStateFingerprint(unsignedPayload),
    };

    const first = await managedDroneSync(client, payload);
    const unchangedStartedAt = performance.now();
    const second = await managedDroneSync(client, payload);
    const unchangedDurationMs = performance.now() - unchangedStartedAt;

    expect(first.changed).toBe(true);
    expect(await fs.readFile(path.join(skillRoot, 'example', 'SKILL.md'), 'utf8')).toBe(
      '# Example\n',
    );
    expect(await fs.stat(path.join(skillRoot, 'retired')).catch(() => null)).toBeNull();
    expect(JSON.parse(await fs.readFile(mcpPath, 'utf8')).mcpServers).toEqual({
      unmanaged: { command: 'keep-me' },
      'drone-hub': { url: 'http://host.docker.internal/mcp' },
    });
    expect(await fs.readFile(agentsPath, 'utf8')).toBe('# Managed instructions\n');
    expect(second).toMatchObject({ changed: false, filesWritten: 0 });
    expect(second.durationMs).toBeLessThan(100);
    expect(unchangedDurationMs).toBeLessThan(100);

    const skillFilePath = path.join(skillRoot, 'example', 'SKILL.md');
    const statePath = path.join(root, 'managed-state.json');
    const storedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
    await fs.writeFile(skillFilePath, '# Changed\n');
    const changedStat = await fs.lstat(skillFilePath);
    const fileProbe = storedState.outputs.find((probe: any) => probe.path === skillFilePath);
    Object.assign(fileProbe, {
      size: changedStat.size,
      mode: changedStat.mode,
      mtimeMs: changedStat.mtimeMs,
    });
    await fs.writeFile(statePath, JSON.stringify(storedState));
    const contentRepaired = await managedDroneSync(client, payload);
    expect(contentRepaired.changed).toBe(true);
    expect(await fs.readFile(skillFilePath, 'utf8')).toBe('# Example\n');

    await fs.rm(skillFilePath);
    const repaired = await managedDroneSync(client, payload);
    expect(repaired.changed).toBe(true);
    expect(await fs.readFile(skillFilePath, 'utf8')).toBe('# Example\n');

    await fs.writeFile(path.join(skillRoot, '.drone-managed-skills.json'), '{broken');
    const withoutSkills = {
      ...unsignedPayload,
      skillTargets: unsignedPayload.skillTargets.map((target) => ({ ...target, packages: [] })),
    };
    const staleContentRemoved = await managedDroneSync(client, {
      ...withoutSkills,
      fingerprint: managedDroneStateFingerprint(withoutSkills),
    });
    expect(staleContentRemoved.changed).toBe(true);
    expect(await fs.stat(path.join(skillRoot, 'example')).catch(() => null)).toBeNull();

    await fs.writeFile(statePath, '{broken');
    const metadataRepaired = await managedDroneSync(client, payload);
    expect(metadataRepaired.changed).toBe(true);
    expect(JSON.parse(await fs.readFile(statePath, 'utf8')).fingerprint).toBe(payload.fingerprint);
  });

  test('applies a full four-agent managed projection in under 100ms', async () => {
    const { client, root } = await startWorkspaceServer();
    const skillRoots = [
      path.join(root, '.agents', 'skills'),
      path.join(root, '.claude', 'skills'),
      path.join(root, '.cursor', 'skills'),
      path.join(root, '.config', 'opencode', 'skills'),
    ];
    const mcpTargets = [
      { configPath: path.join(root, '.codex', 'config.toml'), format: 'toml' as const },
      { configPath: path.join(root, '.cursor', 'mcp.json'), format: 'json' as const },
      { configPath: path.join(root, '.claude.json'), format: 'json' as const },
      {
        configPath: path.join(root, '.config', 'opencode', 'opencode.json'),
        format: 'json' as const,
      },
    ];
    const packages = ['one', 'two', 'three', 'four'].map((slug) => ({
      slug,
      files: [{ path: 'SKILL.md', content: `# ${slug}\n`.repeat(20), executable: false }],
    }));
    const unsignedPayload = {
      version: 1 as const,
      skillTargets: skillRoots.map((rootPath) => ({ rootPath, packages })),
      mcpTargets: mcpTargets.map((target) => ({
        configPath: target.configPath,
        projection:
          target.format === 'toml'
            ? {
                format: 'toml' as const,
                managedNames: ['drone-hub'],
                managedBlock: '# drone-hub-managed-mcp-start\n# drone-hub-managed-mcp-end',
              }
            : {
                format: 'json' as const,
                managedNames: ['drone-hub'],
                rootKey: target.configPath.endsWith('opencode.json')
                  ? ('mcp' as const)
                  : ('mcpServers' as const),
                entries: { 'drone-hub': { url: 'http://host.docker.internal/mcp' } },
              },
      })),
      agentsFile: { path: path.join(root, 'repo', 'AGENTS.md'), content: '# Instructions\n' },
    };
    const payload = {
      ...unsignedPayload,
      fingerprint: managedDroneStateFingerprint(unsignedPayload),
    };

    const startedAt = performance.now();
    const result = await managedDroneSync(client, payload);
    const endToEndDurationMs = performance.now() - startedAt;

    expect(result.changed).toBe(true);
    expect(result.filesWritten).toBe(29);
    expect(result.durationMs).toBeLessThan(100);
    expect(endToEndDurationMs).toBeLessThan(100);
  });

  test('rejects duplicate managed package targets before changing the filesystem', async () => {
    const { client, root } = await startWorkspaceServer();
    const skillRoot = path.join(root, '.agents', 'skills');
    const duplicatePackage = {
      slug: 'example',
      files: [{ path: 'SKILL.md', content: '# Example\n' }],
    };
    const desiredState = {
      version: 1 as const,
      skillTargets: [
        {
          rootPath: skillRoot,
          packages: [duplicatePackage, duplicatePackage],
        },
      ],
      mcpTargets: [],
    };

    const error = await managedDroneSync(client, {
      ...desiredState,
      fingerprint: managedDroneStateFingerprint(desiredState),
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(DroneApiRequestError);
    expect(error.statusCode).toBe(400);
    expect(await fs.stat(skillRoot).catch(() => null)).toBeNull();
  });

  test('reads and atomically writes files larger than the exec argument limit', async () => {
    const { client, root } = await startWorkspaceServer();
    const filePath = path.join(root, 'large.txt');
    const content = Buffer.from('large-content\n'.repeat(55_000));

    const written = await workspaceWriteFile(client, filePath, content);
    const read = await workspaceReadFile(client, filePath);

    expect(written.size).toBe(content.length);
    expect(read.data.equals(content)).toBe(true);
    expect(read.size).toBe(content.length);
  });

  test('supports full-size resumable transfer chunks without command arguments', async () => {
    const { client, root } = await startWorkspaceServer();
    const filePath = path.join(root, 'transfer.part');
    const content = Buffer.alloc(128 * 1024, 0x5a);
    await fs.writeFile(filePath, '');

    const written = await workspaceWriteChunk(client, { path: filePath, offset: 0, data: content });
    const replayed = await workspaceWriteChunk(client, {
      path: filePath,
      offset: 0,
      data: content,
    });
    const read = await workspaceReadChunk(client, {
      path: filePath,
      offset: 0,
      length: content.length,
    });

    expect(written.offset).toBe(content.length);
    expect(replayed.offset).toBe(content.length);
    expect(read.equals(content)).toBe(true);
  });

  test('executes commands and applies a mutation batch in one request', async () => {
    const { client, root } = await startWorkspaceServer();
    const source = path.join(root, 'source.txt');
    const moved = path.join(root, 'moved.txt');
    const added = path.join(root, 'added.txt');
    await fs.writeFile(source, 'source');

    const batch = await workspaceBatch(client, [
      { type: 'move', fromPath: source, toPath: moved },
      { type: 'write', path: added, content: 'added' },
    ]);
    const executed = await workspaceExec(client, {
      cmd: 'bash',
      args: ['-lc', 'printf workspace-ok'],
    });

    expect(batch.applied).toBe(2);
    expect(await fs.readFile(moved, 'utf8')).toBe('source');
    expect(await fs.readFile(added, 'utf8')).toBe('added');
    expect(executed).toMatchObject({ code: 0, stdout: 'workspace-ok', timedOut: false });
  });

  test('reuses Git hashes until a workspace file changes', async () => {
    const { client, root } = await startWorkspaceServer();
    await workspaceExec(client, { cmd: 'git', args: ['init', '--quiet', root] });
    await fs.writeFile(path.join(root, 'changed.txt'), 'first version');

    const first = await workspaceGitHashes(client, {
      repoRoot: root,
      paths: ['changed.txt'],
    });
    const second = await workspaceGitHashes(client, {
      repoRoot: root,
      paths: ['changed.txt'],
    });

    expect(first).toMatchObject({ cacheHits: 0, hashed: 1 });
    expect(first.hashes).toHaveLength(1);
    expect(first.hashes[0]).toMatchObject({ path: 'changed.txt', lineCount: 1, binary: false });
    expect(second).toMatchObject({
      cacheHits: 1,
      hashed: 0,
      hashes: first.hashes,
    });

    await fs.writeFile(path.join(root, 'changed.txt'), 'a different second version');
    const third = await workspaceGitHashes(client, {
      repoRoot: root,
      paths: ['changed.txt'],
    });

    expect(third).toMatchObject({ cacheHits: 0, hashed: 1 });
    expect(third.hashes[0]?.hash).not.toBe(first.hashes[0]?.hash);
  });

  test('hashes and counts symlink blobs instead of their target contents', async () => {
    const { client, root } = await startWorkspaceServer();
    await workspaceExec(client, { cmd: 'git', args: ['init', '--quiet', root] });
    await fs.writeFile(path.join(root, 'target.txt'), 'target\nhas\nthree lines\n');
    await fs.symlink('target.txt', path.join(root, 'link.txt'));

    const result = await workspaceGitHashes(client, {
      repoRoot: root,
      paths: ['link.txt'],
    });
    const linkContent = Buffer.from('target.txt');
    const expectedHash = crypto
      .createHash('sha1')
      .update(Buffer.from(`blob ${linkContent.length}\0`, 'utf8'))
      .update(linkContent)
      .digest('hex');

    expect(result.hashes).toEqual([
      { path: 'link.txt', hash: expectedHash, lineCount: 1, binary: false },
    ]);
  });

  test('does not hash paths outside the requested repository', async () => {
    const { client, root } = await startWorkspaceServer();
    const error = await workspaceGitHashes(client, {
      repoRoot: root,
      paths: ['../outside.txt'],
    })
      .then(() => null)
      .catch((value) => value);

    expect(error).toBeInstanceOf(DroneApiRequestError);
    expect(error.statusCode).toBe(400);
  });

  test('splits Git hash work before command arguments exceed the daemon limit', async () => {
    const { client, root } = await startWorkspaceServer();
    await workspaceExec(client, { cmd: 'git', args: ['init', '--quiet', root] });
    const directory = 'd'.repeat(160);
    await fs.mkdir(path.join(root, directory));
    const paths = Array.from({ length: 380 }, (_, index) =>
      `${directory}/${'f'.repeat(180)}-${String(index).padStart(3, '0')}.txt`,
    );
    await Promise.all(paths.map((relativePath) => fs.writeFile(path.join(root, relativePath), relativePath)));

    const result = await workspaceGitHashes(client, { repoRoot: root, paths });

    expect(result).toMatchObject({ cacheHits: 0, hashed: paths.length });
    expect(result.hashes).toHaveLength(paths.length);
  });

  test('rejects non-string Git hash paths', async () => {
    const { client, root } = await startWorkspaceServer();
    const error = await workspaceGitHashes(client, {
      repoRoot: root,
      paths: [{ path: 'changed.txt' }] as any,
    })
      .then(() => null)
      .catch((value) => value);

    expect(error).toBeInstanceOf(DroneApiRequestError);
    expect(error.statusCode).toBe(400);
  });

  test('terminates commands at the requested timeout', async () => {
    const { client } = await startWorkspaceServer();
    const executed = await workspaceExec(client, {
      cmd: 'bash',
      args: ['-lc', 'sleep 5'],
      timeoutMs: 25,
    });

    expect(executed).toMatchObject({ code: 124, timedOut: true });
  });

  test('bounds command output without stopping output drains', async () => {
    const { client } = await startWorkspaceServer();
    const executed = await workspaceExec(client, {
      cmd: 'bash',
      args: ['-lc', 'printf 1234567890'],
      maxOutputBytes: 4,
    });

    expect(executed).toMatchObject({
      code: 0,
      stdout: '1234',
      stdoutBytes: 10,
      stdoutTruncated: true,
    });
  });

  test('rejects malformed command and chunk parameters', async () => {
    const { client, root } = await startWorkspaceServer();
    const filePath = path.join(root, 'chunk.txt');
    await fs.writeFile(filePath, 'content');

    const commandError = await workspaceExec(client, {
      cmd: 'printf',
      args: [{}],
    } as any)
      .then(() => null)
      .catch((value) => value);
    const chunkError = await workspaceReadChunk(client, {
      path: filePath,
      offset: Number.NaN,
      length: 1,
    })
      .then(() => null)
      .catch((value) => value);

    expect(commandError).toBeInstanceOf(DroneApiRequestError);
    expect(commandError.statusCode).toBe(400);
    expect(chunkError).toBeInstanceOf(DroneApiRequestError);
    expect(chunkError.statusCode).toBe(400);
  });

  test('validates every batch operation before changing files', async () => {
    const { client, root } = await startWorkspaceServer();
    const filePath = path.join(root, 'unchanged.txt');
    await fs.writeFile(filePath, 'before');

    const error = await workspaceBatch(client, [
      { type: 'write', path: filePath, content: 'after' },
      { type: 'delete', path: '/' },
    ])
      .then(() => null)
      .catch((value) => value);

    expect(error).toBeInstanceOf(DroneApiRequestError);
    expect(error.statusCode).toBe(400);
    expect(await fs.readFile(filePath, 'utf8')).toBe('before');
  });

  test('preflights batch filesystem state before changing files', async () => {
    const { client, root } = await startWorkspaceServer();
    const filePath = path.join(root, 'unchanged.txt');
    await fs.writeFile(filePath, 'before');

    const error = await workspaceBatch(client, [
      { type: 'write', path: filePath, content: 'after' },
      { type: 'delete', path: path.join(root, 'missing.txt') },
    ])
      .then(() => null)
      .catch((value) => value);

    expect(error).toBeInstanceOf(DroneApiRequestError);
    expect(error.statusCode).toBe(404);
    expect(await fs.readFile(filePath, 'utf8')).toBe('before');
  });

  test('rejects file bodies above the editor limit', async () => {
    const { client, root } = await startWorkspaceServer();
    const filePath = path.join(root, 'too-large.txt');
    const error = await workspaceWriteFile(client, filePath, Buffer.alloc(2 * 1024 * 1024 + 1))
      .then(() => null)
      .catch((value) => value);

    expect(error).toBeInstanceOf(DroneApiRequestError);
    expect(error.statusCode).toBe(413);
    expect(await fs.stat(filePath).catch(() => null)).toBeNull();
  });
});
