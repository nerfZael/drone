import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentToolResultError } from '@mariozechner/pi-agent-core';
import { validateToolArguments } from '@mariozechner/pi-ai';
import {
  LocalWorkspaceTarget,
  WorkspaceTargetCatalog,
  createWorkspaceTargetSelectionTools,
  createWorkspaceTransferTools,
  createWorkspaceTargetTools,
  type WorkspaceTarget,
} from '../src/index';

async function tempWorkspace(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function findTool(tools: ReturnType<typeof createWorkspaceTargetTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`missing tool: ${name}`);
  return tool;
}

function exposesTargetParameter(tool: ReturnType<typeof findTool>): boolean {
  return JSON.stringify(tool.parameters).includes('"target"');
}

describe('Workspace targets', () => {
  test('transfers binary files and folders between local workspaces with progress', async () => {
    const sourceRoot = await tempWorkspace('blip-transfer-source-');
    const destinationRoot = await tempWorkspace('blip-transfer-destination-');
    await mkdir(path.join(sourceRoot, 'assets', 'nested'), { recursive: true });
    const binary = Buffer.alloc(300_000);
    for (let index = 0; index < binary.length; index += 1) binary[index] = index % 251;
    await writeFile(path.join(sourceRoot, 'assets', 'nested', 'sample.bin'), binary);
    await writeFile(path.join(sourceRoot, 'assets', 'readme.txt'), 'transfer me\n');
    const source = new LocalWorkspaceTarget({
      id: 'source',
      workspaceRoot: sourceRoot,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const destination = new LocalWorkspaceTarget({
      id: 'destination',
      workspaceRoot: destinationRoot,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const tool = findTool(
      createWorkspaceTransferTools(new WorkspaceTargetCatalog([source, destination])) as ReturnType<
        typeof createWorkspaceTargetTools
      >,
      'transfer_files',
    );
    const updates: any[] = [];
    const result = await tool.execute(
      'transfer-call',
      {
        sourceTarget: 'source',
        sourcePath: 'assets',
        destinationTarget: 'destination',
        destinationPath: 'copied-assets',
      } as never,
      undefined,
      (update) => updates.push(update.details),
    );

    expect(
      await readFile(path.join(destinationRoot, 'copied-assets', 'nested', 'sample.bin')),
    ).toEqual(binary);
    expect(await readFile(path.join(destinationRoot, 'copied-assets', 'readme.txt'), 'utf8')).toBe(
      'transfer me\n',
    );
    expect(result.details).toMatchObject({
      type: 'workspace_transfer',
      phase: 'completed',
      fileCount: 2,
      completedFiles: 2,
      transferredBytes: binary.length + 12,
    });
    expect(
      updates.some((update) => update.files?.some((file: any) => file.transferredBytes > 0)),
    ).toBe(true);
    expect(
      updates.some(
        (update) => update.filesPartial !== true && update.files?.length === 2,
      ),
    ).toBe(true);
    expect(
      updates.some((update) => update.filesPartial === true && update.files?.length === 1),
    ).toBe(true);
  });

  test('retries a chunk safely when its successful write acknowledgment is lost', async () => {
    const sourceRoot = await tempWorkspace('blip-transfer-retry-source-');
    const destinationRoot = await tempWorkspace('blip-transfer-retry-destination-');
    await writeFile(path.join(sourceRoot, 'retry.txt'), 'written once\n');
    const source = new LocalWorkspaceTarget({
      id: 'source',
      workspaceRoot: sourceRoot,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const localDestination = new LocalWorkspaceTarget({
      id: 'destination',
      workspaceRoot: destinationRoot,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const adapter = localDestination.transfer!.destination!;
    let loseAcknowledgment = true;
    const destination: WorkspaceTarget = {
      descriptor: localDestination.descriptor,
      transfer: {
        destination: {
          ...adapter,
          writeChunk: async (input, signal) => {
            const result = await adapter.writeChunk(input, signal);
            if (loseAcknowledgment) {
              loseAcknowledgment = false;
              throw Object.assign(new Error('connection closed before acknowledgment'), {
                code: 'ECONNRESET',
              });
            }
            return result;
          },
        },
      },
      execute: (call) => localDestination.execute(call),
    };
    const tool = findTool(
      createWorkspaceTransferTools(
        new WorkspaceTargetCatalog([source, destination]),
      ) as ReturnType<typeof createWorkspaceTargetTools>,
      'transfer_files',
    );

    const result = await tool.execute('transfer-retry', {
      sourceTarget: 'source',
      sourcePath: 'retry.txt',
      destinationTarget: 'destination',
      destinationPath: 'retry.txt',
    } as never);

    expect(result.details).toMatchObject({ phase: 'completed', completedFiles: 1, retries: 1 });
    expect(await readFile(path.join(destinationRoot, 'retry.txt'), 'utf8')).toBe('written once\n');
  });

  test('retries final source verification and bounds destination transfer ids', async () => {
    const sourceRoot = await tempWorkspace('blip-transfer-verify-source-');
    const destinationRoot = await tempWorkspace('blip-transfer-verify-destination-');
    await writeFile(path.join(sourceRoot, 'verify.txt'), 'verify me\n');
    const localSource = new LocalWorkspaceTarget({
      id: 'source',
      workspaceRoot: sourceRoot,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const sourceAdapter = localSource.transfer!.source!;
    let statCalls = 0;
    const source: WorkspaceTarget = {
      descriptor: localSource.descriptor,
      transfer: {
        source: {
          ...sourceAdapter,
          stat: async (sourcePath, signal) => {
            statCalls += 1;
            if (statCalls === 2)
              throw Object.assign(new Error('verification connection reset'), {
                code: 'ECONNRESET',
              });
            return sourceAdapter.stat(sourcePath, signal);
          },
        },
      },
      execute: (call) => localSource.execute(call),
    };
    const localDestination = new LocalWorkspaceTarget({
      id: 'destination',
      workspaceRoot: destinationRoot,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const destinationAdapter = localDestination.transfer!.destination!;
    let usedTransferId = '';
    const destination: WorkspaceTarget = {
      descriptor: localDestination.descriptor,
      transfer: {
        destination: {
          ...destinationAdapter,
          prepareFile: (input, signal) => {
            usedTransferId = input.transferId;
            return destinationAdapter.prepareFile(input, signal);
          },
        },
      },
      execute: (call) => localDestination.execute(call),
    };
    const tool = findTool(
      createWorkspaceTransferTools(
        new WorkspaceTargetCatalog([source, destination]),
      ) as ReturnType<typeof createWorkspaceTargetTools>,
      'transfer_files',
    );

    const result = await tool.execute('x'.repeat(1_000), {
      sourceTarget: 'source',
      sourcePath: 'verify.txt',
      destinationTarget: 'destination',
      destinationPath: 'verify.txt',
    } as never);

    expect(result.details).toMatchObject({ phase: 'completed', retries: 1 });
    expect(usedTransferId.length).toBeLessThanOrEqual(240);
    expect(await readFile(path.join(destinationRoot, 'verify.txt'), 'utf8')).toBe('verify me\n');
  });

  test('does not retry cancellation and cleans up with a fresh signal', async () => {
    const sourceRoot = await tempWorkspace('blip-transfer-cancel-source-');
    const destinationRoot = await tempWorkspace('blip-transfer-cancel-destination-');
    await writeFile(path.join(sourceRoot, 'cancel.txt'), 'cancel me\n');
    const controller = new AbortController();
    const localSource = new LocalWorkspaceTarget({
      id: 'source',
      workspaceRoot: sourceRoot,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const sourceAdapter = localSource.transfer!.source!;
    const source: WorkspaceTarget = {
      descriptor: localSource.descriptor,
      transfer: {
        source: {
          ...sourceAdapter,
          readChunk: async () => {
            controller.abort();
            throw controller.signal.reason;
          },
        },
      },
      execute: (call) => localSource.execute(call),
    };
    const localDestination = new LocalWorkspaceTarget({
      id: 'destination',
      workspaceRoot: destinationRoot,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const destinationAdapter = localDestination.transfer!.destination!;
    let cleanupSignalWasFresh = false;
    const destination: WorkspaceTarget = {
      descriptor: localDestination.descriptor,
      transfer: {
        destination: {
          ...destinationAdapter,
          abortFile: (input, signal) => {
            cleanupSignalWasFresh = signal?.aborted === false;
            return destinationAdapter.abortFile!(input, signal);
          },
        },
      },
      execute: (call) => localDestination.execute(call),
    };
    const tool = findTool(
      createWorkspaceTransferTools(
        new WorkspaceTargetCatalog([source, destination]),
      ) as ReturnType<typeof createWorkspaceTargetTools>,
      'transfer_files',
    );

    let failure: AgentToolResultError | undefined;
    try {
      await tool.execute(
        'transfer-cancel',
        {
          sourceTarget: 'source',
          sourcePath: 'cancel.txt',
          destinationTarget: 'destination',
          destinationPath: 'cancel.txt',
        } as never,
        controller.signal,
      );
    } catch (error) {
      if (error instanceof AgentToolResultError) failure = error;
      else throw error;
    }

    expect(failure!.result.details).toMatchObject({
      phase: 'failed',
      completedFiles: 0,
      retries: 0,
      failure: { resumable: false },
    });
    expect(cleanupSignalWasFresh).toBe(true);
  });

  test('does not follow a symlink at the destination temporary path', async () => {
    const sourceRoot = await tempWorkspace('blip-transfer-symlink-source-');
    const destinationRoot = await tempWorkspace('blip-transfer-symlink-destination-');
    const outsideRoot = await tempWorkspace('blip-transfer-symlink-outside-');
    await writeFile(path.join(sourceRoot, 'source.txt'), 'transferred\n');
    const outsidePath = path.join(outsideRoot, 'outside.txt');
    await writeFile(outsidePath, 'do not change\n');
    await symlink(
      outsidePath,
      path.join(destinationRoot, '.blip-transfer-symlink-attack-0.part'),
    );
    const source = new LocalWorkspaceTarget({
      id: 'source',
      workspaceRoot: sourceRoot,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const destination = new LocalWorkspaceTarget({
      id: 'destination',
      workspaceRoot: destinationRoot,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const tool = findTool(
      createWorkspaceTransferTools(new WorkspaceTargetCatalog([source, destination])) as ReturnType<
        typeof createWorkspaceTargetTools
      >,
      'transfer_files',
    );

    await tool.execute('symlink-attack', {
      sourceTarget: 'source',
      sourcePath: 'source.txt',
      destinationTarget: 'destination',
      destinationPath: 'victim.txt',
    } as never);

    expect(await readFile(outsidePath, 'utf8')).toBe('do not change\n');
    expect(await readFile(path.join(destinationRoot, 'victim.txt'), 'utf8')).toBe('transferred\n');
  });

  test('transfers destination filenames near the filesystem component limit', async () => {
    const sourceRoot = await tempWorkspace('blip-transfer-long-name-source-');
    const destinationRoot = await tempWorkspace('blip-transfer-long-name-destination-');
    const longName = `${'x'.repeat(236)}.txt`;
    await writeFile(path.join(sourceRoot, longName), 'long name\n');
    const source = new LocalWorkspaceTarget({
      id: 'source',
      workspaceRoot: sourceRoot,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const destination = new LocalWorkspaceTarget({
      id: 'destination',
      workspaceRoot: destinationRoot,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const tool = findTool(
      createWorkspaceTransferTools(
        new WorkspaceTargetCatalog([source, destination]),
      ) as ReturnType<typeof createWorkspaceTargetTools>,
      'transfer_files',
    );

    await tool.execute('long-name-transfer', {
      sourceTarget: 'source',
      sourcePath: longName,
      destinationTarget: 'destination',
      destinationPath: longName,
    } as never);

    expect(await readFile(path.join(destinationRoot, longName), 'utf8')).toBe('long name\n');
  });

  test('returns a compact partial failure and resumes after committed files', async () => {
    const sourceRoot = await tempWorkspace('blip-transfer-resume-source-');
    const destinationRoot = await tempWorkspace('blip-transfer-resume-destination-');
    await mkdir(path.join(sourceRoot, 'bundle'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'bundle', 'a.txt'), 'already copied\n');
    await writeFile(path.join(sourceRoot, 'bundle', 'b.txt'), 'copy after resume\n');
    const source = new LocalWorkspaceTarget({
      id: 'source',
      workspaceRoot: sourceRoot,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const localDestination = new LocalWorkspaceTarget({
      id: 'destination',
      workspaceRoot: destinationRoot,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const adapter = localDestination.transfer!.destination!;
    let failSecondFile = true;
    const preparedPaths: string[] = [];
    const destination: WorkspaceTarget = {
      descriptor: localDestination.descriptor,
      transfer: {
        destination: {
          ...adapter,
          prepareFile: (input, signal) => {
            preparedPaths.push(input.path);
            if (failSecondFile && input.path.endsWith('/b.txt')) {
              throw Object.assign(new Error('simulated destination failure'), {
                code: 'INVALID_REQUEST',
              });
            }
            return adapter.prepareFile(input, signal);
          },
        },
      },
      execute: (call) => localDestination.execute(call),
    };
    const tool = findTool(
      createWorkspaceTransferTools(
        new WorkspaceTargetCatalog([source, destination]),
      ) as ReturnType<typeof createWorkspaceTargetTools>,
      'transfer_files',
    );
    const args = {
      sourceTarget: 'source',
      sourcePath: 'bundle',
      destinationTarget: 'destination',
      destinationPath: 'copied-bundle',
    };

    let failure: AgentToolResultError | undefined;
    try {
      await tool.execute('transfer-failure', args as never);
    } catch (error) {
      if (error instanceof AgentToolResultError) failure = error;
      else throw error;
    }

    expect(failure).toBeDefined();
    expect(failure!.result.details).toMatchObject({
      type: 'workspace_transfer',
      phase: 'failed',
      fileCount: 2,
      completedFiles: 1,
      failure: {
        sourcePath: 'bundle/b.txt',
        destinationPath: 'copied-bundle/b.txt',
        resumable: true,
      },
    });
    const resumeToken = (failure!.result.details as any).resumeToken;
    expect(resumeToken).toMatch(/^tr1_1_[0-9a-f]{16}$/);
    const failureText =
      failure!.result.content[0]?.type === 'text' ? failure!.result.content[0].text : '';
    expect(failureText).toContain('Failed at bundle/b.txt');
    expect(failureText).toContain(`resumeToken "${resumeToken}"`);
    expect(failureText).not.toContain('bundle/a.txt');
    expect(await readFile(path.join(destinationRoot, 'copied-bundle', 'a.txt'), 'utf8')).toBe(
      'already copied\n',
    );

    const tamperedResumeToken = resumeToken.replace(/^tr1_1_/, 'tr1_2_');
    await expect(
      tool.execute('transfer-tampered-resume', { ...args, resumeToken: tamperedResumeToken } as never),
    ).rejects.toThrow('resumeToken does not match');

    failSecondFile = false;
    const result = await tool.execute('transfer-resume', { ...args, resumeToken } as never);

    expect(result.details).toMatchObject({
      phase: 'completed',
      fileCount: 2,
      completedFiles: 2,
      resumedFiles: 1,
    });
    expect(preparedPaths.filter((value) => value.endsWith('/a.txt'))).toHaveLength(1);
    expect(await readFile(path.join(destinationRoot, 'copied-bundle', 'b.txt'), 'utf8')).toBe(
      'copy after resume\n',
    );
  });

  test('merges folders, preserves unrelated files, and handles conflicts explicitly', async () => {
    const sourceRoot = await tempWorkspace('blip-transfer-conflict-source-');
    const destinationRoot = await tempWorkspace('blip-transfer-conflict-destination-');
    await mkdir(path.join(sourceRoot, 'bundle'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'bundle', 'a.txt'), 'new value\n');
    await mkdir(path.join(destinationRoot, 'copied-bundle'), { recursive: true });
    await writeFile(path.join(destinationRoot, 'copied-bundle', 'a.txt'), 'old value\n');
    await writeFile(path.join(destinationRoot, 'copied-bundle', 'keep.txt'), 'keep me\n');
    const source = new LocalWorkspaceTarget({
      id: 'source',
      workspaceRoot: sourceRoot,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const destination = new LocalWorkspaceTarget({
      id: 'destination',
      workspaceRoot: destinationRoot,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const tool = findTool(
      createWorkspaceTransferTools(new WorkspaceTargetCatalog([source, destination])) as ReturnType<
        typeof createWorkspaceTargetTools
      >,
      'transfer_files',
    );
    const args = {
      sourceTarget: 'source',
      sourcePath: 'bundle',
      destinationTarget: 'destination',
      destinationPath: 'copied-bundle',
    };

    await expect(tool.execute('conflict-default', args as never)).rejects.toThrow(
      'destination already exists',
    );
    expect(await readFile(path.join(destinationRoot, 'copied-bundle', 'a.txt'), 'utf8')).toBe(
      'old value\n',
    );

    await tool.execute('conflict-overwrite', { ...args, overwrite: true } as never);
    expect(await readFile(path.join(destinationRoot, 'copied-bundle', 'a.txt'), 'utf8')).toBe(
      'new value\n',
    );
    expect(await readFile(path.join(destinationRoot, 'copied-bundle', 'keep.txt'), 'utf8')).toBe(
      'keep me\n',
    );

    await mkdir(path.join(destinationRoot, 'file-target'), { recursive: true });
    await expect(
      tool.execute('conflict-type', {
        sourceTarget: 'source',
        sourcePath: 'bundle/a.txt',
        destinationTarget: 'destination',
        destinationPath: 'file-target',
        overwrite: true,
      } as never),
    ).rejects.toThrow('destination path is not a file');
  });

  test('runs the same read and write contracts through a local target', async () => {
    const root = await tempWorkspace('blip-target-local-');
    const target = new LocalWorkspaceTarget({
      workspaceRoot: root,
      permissionMode: 'workspace-write',
      profile: 'no-shell-workspace-write',
    });
    const tools = createWorkspaceTargetTools({
      profile: 'no-shell-workspace-write',
      resolveTarget: () => target,
    });
    expect(exposesTargetParameter(findTool(tools, 'read_file'))).toBe(false);

    await findTool(tools, 'write_file').execute('write', {
      path: 'notes/example.txt',
      content: 'hello target\n',
      mode: 'create',
    } as never);
    const read = await findTool(tools, 'read_file').execute('read', {
      path: 'notes/example.txt',
    } as never);

    expect(await readFile(path.join(root, 'notes/example.txt'), 'utf8')).toBe('hello target\n');
    expect(read.content[0]?.type === 'text' ? read.content[0].text : '').toContain('hello target');
    expect(read.details).toMatchObject({ target: { id: 'local', kind: 'local' } });
  });

  test('supports explicit targets and freezes resolution before execution', async () => {
    const rootA = await tempWorkspace('blip-target-a-');
    const rootB = await tempWorkspace('blip-target-b-');
    await writeFile(path.join(rootA, 'value.txt'), 'from a\n');
    await writeFile(path.join(rootB, 'value.txt'), 'from b\n');
    const targetA = new LocalWorkspaceTarget({
      id: 'a',
      workspaceRoot: rootA,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const targetB = new LocalWorkspaceTarget({
      id: 'b',
      workspaceRoot: rootB,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const catalog = new WorkspaceTargetCatalog([targetA, targetB], 'a');
    const tools = createWorkspaceTargetTools({
      profile: 'read-only',
      catalog,
    });
    expect(exposesTargetParameter(findTool(tools, 'read_file'))).toBe(true);
    expect(
      validateToolArguments(
        findTool(tools, 'read_file') as any,
        {
          id: 'validated-explicit',
          type: 'toolCall',
          name: 'read_file',
          arguments: { target: 'a', path: 'value.txt' },
        } as any,
      ),
    ).toMatchObject({ target: 'a', path: 'value.txt' });

    const frozen = await findTool(tools, 'read_file').execute('frozen', {
      path: 'value.txt',
    } as never);
    const explicit = await findTool(tools, 'read_file').execute('explicit', {
      target: 'a',
      path: 'value.txt',
    } as never);

    expect(frozen.content[0]?.type === 'text' ? frozen.content[0].text : '').toContain('from a');
    expect(explicit.details).toMatchObject({ target: { id: 'a' } });
  });

  test('lists and selects the active target', async () => {
    const rootA = await tempWorkspace('blip-target-select-a-');
    const rootB = await tempWorkspace('blip-target-select-b-');
    const targetA = new LocalWorkspaceTarget({
      id: 'a',
      workspaceRoot: rootA,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const targetB = new LocalWorkspaceTarget({
      id: 'b',
      workspaceRoot: rootB,
      permissionMode: 'read-only',
      profile: 'read-only',
    });
    const catalog = new WorkspaceTargetCatalog([targetA, targetB], 'a');
    const tools = createWorkspaceTargetSelectionTools(catalog);
    const listed = await findTool(
      tools as ReturnType<typeof createWorkspaceTargetTools>,
      'list_targets',
    ).execute('list', {} as never);
    expect(listed.details).toMatchObject({
      activeTargetId: 'a',
      targets: [{ id: 'a' }, { id: 'b' }],
    });
    await findTool(tools as ReturnType<typeof createWorkspaceTargetTools>, 'set_target').execute(
      'set',
      { target: 'b' } as never,
    );
    expect(catalog.active()).toMatchObject({ id: 'b' });
  });

  test('omits selection and target parameters for a single bound target', () => {
    const target: WorkspaceTarget = {
      descriptor: {
        id: 'only',
        kind: 'artifacts',
        label: 'Only',
        rootLabel: 'only',
        capabilities: ['files.read'],
      },
      async execute() {
        return { content: [], details: {} };
      },
    };
    const catalog = new WorkspaceTargetCatalog([target]);
    const tools = createWorkspaceTargetTools({ profile: 'read-only', catalog });
    expect(createWorkspaceTargetSelectionTools(catalog)).toEqual([]);
    expect(exposesTargetParameter(findTool(tools, 'read_file'))).toBe(false);
    expect(() =>
      validateToolArguments(
        findTool(tools, 'read_file') as any,
        {
          id: 'invalid-explicit',
          type: 'toolCall',
          name: 'read_file',
          arguments: { target: 'only', path: 'value.txt' },
        } as any,
      ),
    ).toThrow();
  });

  test('rejects target selection dispatched alongside a filesystem call', async () => {
    let releaseRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let markExecuting!: () => void;
    const executing = new Promise<void>((resolve) => {
      markExecuting = resolve;
    });
    const slow: WorkspaceTarget = {
      descriptor: {
        id: 'slow',
        kind: 'remote-device',
        label: 'Slow',
        rootLabel: 'slow',
        capabilities: ['files.read'],
      },
      async execute() {
        markExecuting();
        await readStarted;
        return { content: [], details: {} };
      },
    };
    const other: WorkspaceTarget = {
      descriptor: {
        id: 'other',
        kind: 'remote-device',
        label: 'Other',
        rootLabel: 'other',
        capabilities: ['files.read'],
      },
      async execute() {
        return { content: [], details: {} };
      },
    };
    const catalog = new WorkspaceTargetCatalog([slow, other], 'slow');
    const workspaceTools = createWorkspaceTargetTools({ profile: 'read-only', catalog });
    const selectionTools = createWorkspaceTargetSelectionTools(catalog);
    const read = findTool(workspaceTools, 'read_file').execute('read', {
      path: 'value.txt',
    } as never);
    await executing;
    await expect(
      findTool(
        selectionTools as ReturnType<typeof createWorkspaceTargetTools>,
        'set_target',
      ).execute('set', { target: 'other' } as never),
    ).rejects.toThrow('call set_target separately');
    releaseRead();
    await read;
    expect(catalog.active()).toMatchObject({ id: 'slow' });
  });

  test('can add shell to the full workspace-write tool set', () => {
    const tools = createWorkspaceTargetTools({
      profile: 'no-shell-workspace-write',
      includeShell: true,
      resolveTarget: () => {
        throw new Error('not executed');
      },
    });
    expect(tools.map((tool) => tool.name)).toContain('bash');
    expect(tools.map((tool) => tool.name)).toContain('write_file');
  });

  test('rejects a call before execution when the target lacks its capability', async () => {
    let executed = false;
    const target: WorkspaceTarget = {
      descriptor: {
        id: 'artifacts',
        kind: 'artifacts',
        label: 'Artifacts',
        rootLabel: 'artifacts:test',
        capabilities: ['files.read'],
      },
      async execute() {
        executed = true;
        throw new Error('must not execute');
      },
    };
    const tools = createWorkspaceTargetTools({
      profile: 'no-shell-workspace-write',
      resolveTarget: () => target,
    });

    await expect(
      findTool(tools, 'write_file').execute('denied', {
        path: 'value.txt',
        content: 'no',
        mode: 'create',
      } as never),
    ).rejects.toThrow('lacks capability files.write');
    expect(executed).toBe(false);
  });
});
