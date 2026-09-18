import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareCompanionAttachments, readCompanionAttachments, companionHomeRoot, storeCompanionUpload, removeCompanionUpload, validateCompanionAttachments, readCompanionHomeImages, companionHomeRevision, watchCompanionHome } from '../src/hub/companion/companion-attachments';
const image = { name: 'shot.png', mime: 'image/png', size: 3, dataBase64: 'cG5n' };

test('images reach the model and land in the home workspace uploads folder with reusable proposal/transfer paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-attachments-test-'));
  try {
    const result = await prepareCompanionAttachments('Explain this', [image], root);
    expect(typeof result).toBe('object');
    if (typeof result === 'string') throw new Error('missing images');
    expect(result.images).toEqual([{ type: 'image', mimeType: 'image/png', data: 'cG5n' }]);
    const file = path.join(root, 'uploads', 'shot.png');
    expect(await fs.readFile(file, 'utf8')).toBe('png');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(result.text).toContain(file);
    expect(result.text).toContain('uploads/shot.png');
    expect(result.text).toContain('companion-home');
    // A second upload with the same name never overwrites the first.
    const again = await prepareCompanionAttachments('Again', [{ ...image, dataBase64: Buffer.from('new').toString('base64') }], root);
    expect(typeof again === 'string' ? again : again.text).toContain('uploads/shot-2.png');
    expect(await fs.readFile(file, 'utf8')).toBe('png');
    expect(result.text).toContain('attachmentPaths');
    expect(await readCompanionAttachments([file], [root])).toMatchObject([image]);
    await expect(readCompanionAttachments(['/etc/passwd'], [root])).rejects.toThrow('Not a Companion');
    await fs.symlink('/etc/passwd', path.join(root, 'escape.png'));
    await expect(readCompanionAttachments([path.join(root, 'escape.png')], [root])).rejects.toThrow('Not a Companion');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('pasted text is inlined into the instruction, stored beside captures, and reusable as a proposal attachment', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-attachments-test-'));
  try {
    const note = { name: 'pasted-text.txt', mime: 'text/plain', size: 11, dataBase64: Buffer.from('héllo wörld').toString('base64') };
    const textOnly = await prepareCompanionAttachments('Summarise', [note], root);
    expect(typeof textOnly).toBe('string');
    expect(textOnly).toContain('Summarise\n\nPasted text attachment 1');
    expect(textOnly).toContain('<pasted_text>\nhéllo wörld\n</pasted_text>');
    const mixed = await prepareCompanionAttachments('Compare', [image, note], root);
    if (typeof mixed === 'string') throw new Error('missing images');
    expect(mixed.images).toHaveLength(1);
    expect(mixed.text).toContain('shot.png');
    expect(mixed.text).toContain('héllo wörld');
    const stored = /\((\/[^,]+pasted-text-2\.txt),/.exec(mixed.text)![1];
    expect(await fs.readFile(stored, 'utf8')).toBe('héllo wörld');
    expect(await readCompanionAttachments([stored], [root])).toMatchObject([{ mime: 'text/plain', name: 'pasted-text-2.txt' }]);
    await expect(prepareCompanionAttachments('x', [{ ...note, mime: 'application/pdf' }], root)).rejects.toThrow();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('captures are uploaded as taken, are not limited in number, and beyond the inline budget reach the model as paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-attachments-test-'));
  try {
    const stored = [];
    for (let index = 0; index < 12; index++) stored.push(await storeCompanionUpload({ ...image, name: `shot-${index}.png` }, root));
    expect(stored[0]).toMatchObject({ name: 'shot-0.png', mime: 'image/png', size: 3, relativePath: 'uploads/shot-0.png' });
    const refs = stored.map(({ relativePath: _relative, ...ref }) => ref);
    expect(validateCompanionAttachments(refs)).toHaveLength(12);
    const result = await prepareCompanionAttachments('Look at all of these', refs, root);
    if (typeof result === 'string') throw new Error('missing images');
    expect(result.images).toHaveLength(8);
    expect(result.text).toContain('4 more attached images are not shown inline');
    expect(result.text).toContain('uploads/shot-11.png');
    // Already-uploaded files are used in place, never copied again.
    expect((await fs.readdir(path.join(root, 'uploads'))).length).toBe(12);
    // Only files inside Companion home can be named, and removal is confined to uploads.
    await expect(prepareCompanionAttachments('x', [{ name: 'passwd', mime: 'text/plain', size: 1, path: '/etc/passwd' }], root)).rejects.toThrow('Not a Companion');
    await fs.writeFile(path.join(root, 'notes.txt'), 'keep');
    await expect(removeCompanionUpload(path.join(root, 'notes.txt'), root)).rejects.toThrow('Not a Companion');
    await removeCompanionUpload(stored[0].path, root);
    await removeCompanionUpload(stored[0].path, root);
    expect((await fs.readdir(path.join(root, 'uploads'))).includes('shot-0.png')).toBe(false);
    expect(await fs.readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('keep');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('view_images reads several home images at once and nothing else; the home revision follows every change', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-attachments-test-'));
  try {
    const first = await storeCompanionUpload({ ...image, name: 'a.png' }, root);
    await storeCompanionUpload({ ...image, name: 'b.png' }, root);
    expect(await readCompanionHomeImages(['uploads/a.png', first.path.replace('a.png', 'b.png')], root)).toMatchObject([
      { relativePath: 'uploads/a.png', mime: 'image/png', size: 3, data: 'cG5n' }, { relativePath: 'uploads/b.png', data: 'cG5n' },
    ]);
    await fs.writeFile(path.join(root, 'notes.txt'), 'text');
    await expect(readCompanionHomeImages(['notes.txt'], root)).rejects.toThrow('not a PNG');
    await expect(readCompanionHomeImages(['uploads/missing.png'], root)).rejects.toThrow('does not exist');
    await expect(readCompanionHomeImages(['/etc/hostname'], root)).rejects.toThrow('not inside Companion home');
    await expect(readCompanionHomeImages(['../../etc/hostname'], root)).rejects.toThrow();
    await expect(readCompanionHomeImages([], root)).rejects.toThrow('1 to 8');
    await expect(readCompanionHomeImages(Array(9).fill('uploads/a.png'), root)).rejects.toThrow('1 to 8');
    const before = await companionHomeRevision(root);
    expect(Object.keys(before.files).some(file => file.endsWith('uploads/a.png'))).toBe(true);
    expect((await companionHomeRevision(root)).revision).toBe(before.revision);
    await fs.writeFile(path.join(root, 'notes.txt'), 'longer text');
    const after = await companionHomeRevision(root);
    expect(after.revision).not.toBe(before.revision);
    expect(after.files[path.join(root, 'notes.txt')]).not.toBe(before.files[path.join(root, 'notes.txt')]);
    await fs.rm(path.join(root, 'notes.txt'));
    expect((await companionHomeRevision(root)).files[path.join(root, 'notes.txt')]).toBeUndefined();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('the home watcher reports nested changes once per burst and stops when closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-attachments-test-'));
  try {
    await fs.mkdir(path.join(root, 'uploads'));
    let notices = 0;
    const watcher = watchCompanionHome(() => { notices++; }, root);
    expect(watcher.active).toBe(true);
    await fs.writeFile(path.join(root, 'uploads', 'a.png'), 'one');
    await fs.writeFile(path.join(root, 'uploads', 'a.png'), 'two');
    await fs.writeFile(path.join(root, 'note.md'), 'three');
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(notices).toBe(1);
    await fs.rm(path.join(root, 'note.md'));
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(notices).toBe(2);
    watcher.close();
    expect(watcher.active).toBe(false);
    await fs.writeFile(path.join(root, 'later.md'), 'ignored');
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(notices).toBe(2);
    expect(watchCompanionHome(() => {}, path.join(root, 'missing')).active).toBe(false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('empty requests stay text-only and the home workspace lives under Companion storage', async () => {
  expect(await prepareCompanionAttachments('hello', [])).toBe('hello');
  expect(companionHomeRoot().split(path.sep).slice(-2)).toEqual(['companion', 'home']);
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
    const selected = { id: 'remote:server:folder', kind: 'remote' as const, deviceId: 'server', deviceName: 'Server', workspaceId: 'folder', name: 'Folder', read: true, write: true, execute: false };
    const access = { targets: [selected], defaultTargetId: selected.id };
    const service = new CompanionWorkspaceService({ workspaceInventory: async () => ({ drones: [], hostWorkspaces: [] }), executeAuthorizedWorkspaceTool: async () => { throw new Error('Shell not needed'); } }, {
      workspaceAccessDevices: async () => ({ self: { id: 'home', name: 'Home' }, devices: [{ id: 'server', name: 'Server' }] }),
      listWorkspaceAccessTargets: async () => [selected], legacyWorkspaceAccessTargets: async () => [],
      remoteWorkspaceTargets: async () => [new blip.LocalWorkspaceTarget({ id: selected.id, workspaceRoot: destination, permissionMode: 'workspace-write', profile: 'no-shell-workspace-write' })],
    }, { read: async () => access, write: async () => {} });
    const tools = await service.tools('test', () => {}, captures);
    await tools.find(tool => tool.name === 'transfer_files')!.execute('copy', {
      sourceTarget: 'companion-home', sourcePath: 'uploads/shot.png', destinationTarget: selected.id, destinationPath: 'received.png',
    }, new AbortController().signal);
    expect(await fs.readFile(path.join(destination, 'received.png'), 'utf8')).toBe('png');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
