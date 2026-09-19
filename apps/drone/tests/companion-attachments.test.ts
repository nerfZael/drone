import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareCompanionAttachments, readCompanionAttachments, companionHomeRoot, storeCompanionUpload, removeCompanionUpload, validateCompanionAttachments, readCompanionHomeImages } from '../src/hub/companion/companion-attachments';
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
    expect(textOnly).toContain('Summarise\n\nText attachment 1');
    expect(textOnly).toContain('<pasted_text>\nhéllo wörld\n</pasted_text>');
    const mixed = await prepareCompanionAttachments('Compare', [image, note], root);
    if (typeof mixed === 'string') throw new Error('missing images');
    expect(mixed.images).toHaveLength(1);
    expect(mixed.text).toContain('shot.png');
    expect(mixed.text).toContain('héllo wörld');
    const stored = /\((\/[^,]+pasted-text-2\.txt),/.exec(mixed.text)![1];
    expect(await fs.readFile(stored, 'utf8')).toBe('héllo wörld');
    expect(await readCompanionAttachments([stored], [root])).toMatchObject([{ mime: 'text/plain', name: 'pasted-text-2.txt' }]);
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
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('text-like files in Companion home travel as text attachments; other types are refused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-attachments-test-'));
  try {
    await fs.writeFile(path.join(root, 'image-transcription.md'), '# Transcription');
    await fs.writeFile(path.join(root, 'data.json'), '{"a":1}');
    await fs.writeFile(path.join(root, 'archive.zip'), 'PK');
    expect(await readCompanionAttachments([path.join(root, 'image-transcription.md'), path.join(root, 'data.json')], [root])).toMatchObject([
      { name: 'image-transcription.md', mime: 'text/plain', dataBase64: Buffer.from('# Transcription').toString('base64') }, { name: 'data.json', mime: 'text/plain' },
    ]);
    // Any other file is a chat attachment too: the drone receives it as a file and is told its path.
    expect(await readCompanionAttachments([path.join(root, 'archive.zip')], [root])).toMatchObject([{ name: 'archive.zip', mime: 'application/octet-stream', size: 2 }]);
    // A dropped Markdown file is uploaded as text and can then be named by an instruction.
    const stored = await storeCompanionUpload({ name: 'plan.md', mime: 'text/plain', size: 6, dataBase64: Buffer.from('# Plan').toString('base64') }, root);
    expect(stored).toMatchObject({ name: 'plan.md', relativePath: 'uploads/plan.md' });
    const prepared = await prepareCompanionAttachments('Read this', [{ name: stored.name, mime: stored.mime, size: stored.size, path: stored.path }], root);
    expect(prepared).toContain('<pasted_text>\n# Plan\n</pasted_text>');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('any file can be attached: it is kept in uploads and given to the model by path', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-attachments-test-'));
  try {
    const pdf = await storeCompanionUpload({ name: '../../Quarterly report.pdf', mime: 'application/pdf', size: 5, dataBase64: Buffer.from('%PDF-').toString('base64') }, root);
    expect(pdf).toMatchObject({ name: 'Quarterly report.pdf', mime: 'application/pdf', size: 5, relativePath: 'uploads/Quarterly report.pdf' });
    expect(await fs.readFile(pdf.path, 'utf8')).toBe('%PDF-');
    const shot = await storeCompanionUpload(image, root);
    const result = await prepareCompanionAttachments('File this', [pdf, shot].map(({ relativePath: _relative, ...ref }) => ref), root);
    if (typeof result === 'string') throw new Error('missing images');
    expect(result.images).toHaveLength(1);
    expect(result.text).toContain('Attached file, given by path');
    expect(result.text).toContain('uploads/Quarterly report.pdf');
    expect(result.text).toContain('attachmentPaths');
    // Only a file: the instruction stays plain text.
    expect(typeof await prepareCompanionAttachments('Just this', [{ name: pdf.name, mime: pdf.mime, size: pdf.size, path: pdf.path }], root)).toBe('string');
    await expect(storeCompanionUpload({ name: 'empty.bin', mime: 'application/octet-stream', dataBase64: '' }, root)).rejects.toThrow();
    await expect(storeCompanionUpload({ name: 'x.bin', mime: 'application/octet-stream', dataBase64: '<script>' }, root)).rejects.toThrow('invalid');
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
