import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareCompanionAttachments, readCompanionAttachments, companionAttachmentsRoot } from '../src/hub/companion/companion-attachments';
const image = { name: 'shot.png', mime: 'image/png', size: 3, dataBase64: 'cG5n' };

test('images reach the model with durable private files and reusable proposal/transfer paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-attachments-test-'));
  try {
    const result = await prepareCompanionAttachments('Explain this', [image], root);
    expect(typeof result).toBe('object');
    if (typeof result === 'string') throw new Error('missing images');
    expect(result.images).toEqual([{ type: 'image', mimeType: 'image/png', data: 'cG5n' }]);
    const [directory] = await fs.readdir(root);
    const file = path.join(root, directory, 'shot.png');
    expect(await fs.readFile(file, 'utf8')).toBe('png');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(result.text).toContain(file);
    expect(result.text).toContain('companion-attachments');
    expect(result.text).toContain('attachmentPaths');
    expect(await readCompanionAttachments([file], root)).toMatchObject([image]);
    await expect(readCompanionAttachments(['/etc/passwd'], root)).rejects.toThrow('Not a Companion');
    await fs.symlink('/etc/passwd', path.join(root, 'escape.png'));
    await expect(readCompanionAttachments([path.join(root, 'escape.png')], root)).rejects.toThrow('Not a Companion');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('empty requests stay text-only and session attachment roots cannot escape storage', async () => {
  expect(await prepareCompanionAttachments('hello', [])).toBe('hello');
  expect(companionAttachmentsRoot('../escape')).toStartWith(companionAttachmentsRoot() + path.sep);
  expect(companionAttachmentsRoot('a')).not.toBe(companionAttachmentsRoot('b'));
  await expect(prepareCompanionAttachments('hello', [{ ...image, dataBase64: '' }])).rejects.toThrow();
});

test('stored originals transfer to a selected writable workspace without shell access', async () => {
  const { CompanionWorkspaceService } = await import('../src/hub/companion/companion-workspaces');
  const { loadBlipTools } = await import('../src/hub/assistant/blip-runtime-loader');
  const blip = await loadBlipTools();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-transfer-test-'));
  try {
    const captures = path.join(root, 'captures');
    const destination = path.join(root, 'workspace');
    await fs.mkdir(destination);
    await prepareCompanionAttachments('Copy this', [image], captures);
    const [capture] = await fs.readdir(captures);
    const selected = { id: 'remote:server:folder', kind: 'remote' as const, deviceId: 'server', deviceName: 'Server', workspaceId: 'folder', name: 'Folder', read: true, write: true, execute: false };
    const access = { targets: [selected], defaultTargetId: selected.id };
    const service = new CompanionWorkspaceService({ workspaceInventory: async () => ({ drones: [], hostWorkspaces: [] }), executeAuthorizedWorkspaceTool: async () => { throw new Error('Shell not needed'); } }, {
      workspaceAccessDevices: async () => ({ self: { id: 'home', name: 'Home' }, devices: [{ id: 'server', name: 'Server' }] }),
      listWorkspaceAccessTargets: async () => [selected], legacyWorkspaceAccessTargets: async () => [],
      remoteWorkspaceTargets: async () => [new blip.LocalWorkspaceTarget({ id: selected.id, workspaceRoot: destination, permissionMode: 'workspace-write', profile: 'no-shell-workspace-write' })],
    }, { read: async () => access, write: async () => {} });
    const tools = await service.tools('test', () => {}, captures);
    await tools.find(tool => tool.name === 'transfer_files')!.execute('copy', {
      sourceTarget: 'companion-attachments', sourcePath: `${capture}/shot.png`, destinationTarget: selected.id, destinationPath: 'received.png',
    }, new AbortController().signal);
    expect(await fs.readFile(path.join(destination, 'received.png'), 'utf8')).toBe('png');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
