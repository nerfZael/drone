import { describe, expect, test } from 'bun:test';
import { applyPatchHunks, parsePatch } from '@blip/tools';

import {
  createAssistantArtifactTransferAdapter,
  listAssistantArtifactFiles,
  readAssistantArtifactFile,
  runAssistantArtifactAction,
  validateAssistantPromptImages,
} from '../src/hub/assistant-artifacts';
import { AssistantArtifactsTarget } from '../src/hub/assistant/targets/assistant-artifacts-target';
import { withTempDroneDataDir } from './test-helpers';

describe('assistant artifacts', () => {
  test('captures baselines before target and transfer mutations', async () => {
    await withTempDroneDataDir('assistant-artifact-mutation-hook-', async () => {
      let calls = 0;
      const beforeMutation = async () => {
        calls += 1;
      };
      const target = new AssistantArtifactsTarget(
        'thread-hooks',
        { parse: parsePatch, applyHunks: applyPatchHunks },
        beforeMutation,
      );
      await target.execute({ callId: 'list', tool: 'list_files', args: {} });
      expect(calls).toBe(0);
      await target.execute({
        callId: 'write',
        tool: 'write_file',
        args: { path: 'note.md', content: 'hello', mode: 'create' },
      });
      expect(calls).toBe(1);

      const transfer = createAssistantArtifactTransferAdapter('thread-transfer-hooks', beforeMutation);
      await transfer.destination!.prepareFile({
        path: 'copy.md',
        transferId: 'transfer-1',
        size: 5,
        overwrite: false,
      });
      expect(calls).toBe(2);
    });
  });

  test('validates prompt image payloads before persistence', () => {
    expect(validateAssistantPromptImages([{ mime: 'image/png', dataBase64: 'aW1hZ2U=' }])).toEqual([
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
    ]);
    expect(() => validateAssistantPromptImages([{ mime: 'text/plain', dataBase64: 'aW1hZ2U=' }])).toThrow('invalid prompt image type');
    expect(() => validateAssistantPromptImages([{ mime: 'image/png', dataBase64: 'not base64' }])).toThrow('looks invalid');
  });

  test('implements supported shared workspace target operations', async () => {
    await withTempDroneDataDir('assistant-artifact-target-', async () => {
      const target = new AssistantArtifactsTarget('thread-target', {
        parse: parsePatch,
        applyHunks: applyPatchHunks,
      });
      await target.execute({
        callId: 'mkdir',
        tool: 'create_directory',
        args: { path: 'notes', recursive: false },
      });
      await target.execute({
        callId: 'write',
        tool: 'write_file',
        args: { path: 'notes/plan.md', content: 'target content', mode: 'create' },
      });
      const read = await target.execute({
        callId: 'read',
        tool: 'read_file',
        args: { path: 'notes/plan.md' },
      });
      const rootList = await target.execute({ callId: 'list-root', tool: 'list_files', args: {} });
      const dottedRootList = await target.execute({ callId: 'list-dot-root', tool: 'list_files', args: { path: '.' } });
      const notesList = await target.execute({ callId: 'list-notes', tool: 'list_files', args: { path: 'notes' } });
      const contentSearch = await target.execute({
        callId: 'search-content',
        tool: 'search_files',
        args: { query: 'target', mode: 'content', path: 'notes' },
      });
      const patternSearch = await target.execute({
        callId: 'search-pattern',
        tool: 'search_files',
        args: { query: 't.rget', mode: 'content', path: 'notes' },
      });
      const nameSearch = await target.execute({
        callId: 'search-name',
        tool: 'search_files',
        args: { query: 'plan', mode: 'name', includeGlob: '**/*.md' },
      });
      await expect(
        target.execute({
          callId: 'search-missing',
          tool: 'search_files',
          args: { query: 'anything', mode: 'content', path: 'missing' },
        }),
      ).rejects.toThrow('artifact path not found');
      await target.execute({
        callId: 'move-source',
        tool: 'write_file',
        args: { path: 'notes/move.md', content: 'move me', mode: 'create' },
      });
      const patchMoved = await target.execute({
        callId: 'patch-move',
        tool: 'apply_patch',
        args: {
          patch: [
            '*** Begin Patch',
            '*** Update File: notes/move.md',
            '*** Move to: archive/nested/moved.md',
            '@@',
            '-move me',
            '+moved',
            '*** End Patch',
          ].join('\n'),
        },
      });
      const patched = await target.execute({
        callId: 'patch',
        tool: 'apply_patch',
        args: {
          patch: [
            '*** Begin Patch',
            '*** Update File: notes/plan.md',
            '@@',
            '-target content',
            '+updated content',
            '*** End Patch',
          ].join('\n'),
        },
      });
      const moved = await target.execute({
        callId: 'move',
        tool: 'move_path',
        args: { from: 'notes/plan.md', to: 'notes/archive.md' },
      });
      await target.execute({
        callId: 'scratch-dir',
        tool: 'create_directory',
        args: { path: 'scratch/nested', recursive: true },
      });
      await target.execute({
        callId: 'scratch-file',
        tool: 'write_file',
        args: { path: 'scratch/nested/temp.txt', content: 'temporary', mode: 'create' },
      });
      const deletedDirectory = await target.execute({
        callId: 'delete-dir',
        tool: 'delete_directory',
        args: { path: 'scratch', recursive: true },
      });

      expect(read.content[0]?.type === 'text' ? read.content[0].text : '').toContain('1 | target content');
      expect(read.details).toMatchObject({ path: 'notes/plan.md', offset: 0, returnedLines: 1, revision: expect.any(String) });
      expect(rootList.content[0]?.type === 'text' ? rootList.content[0].text : '').toContain('dir  notes');
      expect(dottedRootList.content[0]?.type === 'text' ? dottedRootList.content[0].text : '').toContain('dir  notes');
      expect(notesList.content[0]?.type === 'text' ? notesList.content[0].text : '').toContain('file notes/plan.md');
      expect(contentSearch.content[0]?.type === 'text' ? contentSearch.content[0].text : '').toContain('notes/plan.md:1:target content');
      expect(patternSearch.content[0]?.type === 'text' ? patternSearch.content[0].text : '').toContain('notes/plan.md:1:target content');
      expect(nameSearch.content[0]?.type === 'text' ? nameSearch.content[0].text : '').toBe('notes/plan.md');
      expect(patchMoved.details).toMatchObject({
        changedPaths: ['notes/move.md', 'archive/nested/moved.md'],
        operations: ['update'],
      });
      expect((await readAssistantArtifactFile('thread-target', 'archive/nested/moved.md')).content).toBe('moved');
      expect(patched.details).toMatchObject({ changedPaths: ['notes/plan.md'], operations: ['update'] });
      expect(moved.details).toMatchObject({ from: 'notes/plan.md', to: 'notes/archive.md' });
      expect((await readAssistantArtifactFile('thread-target', 'notes/archive.md')).content).toBe('updated content');
      expect(deletedDirectory.details).toMatchObject({ path: 'scratch', recursive: true });
      expect((await listAssistantArtifactFiles('thread-target')).map((file) => file.path)).toEqual([
        'archive/nested/moved.md',
        'notes/archive.md',
      ]);
      expect(target.descriptor.label).toBe('Artifacts');
      expect(target.descriptor.capabilities).not.toContain('shell.execute');
      expect(target.descriptor.capabilities).toEqual(expect.arrayContaining([
        'files.search',
        'files.move',
        'directories.delete',
        'patch.apply',
      ]));
      await expect(target.execute({ callId: 'duplicate', tool: 'write_file', args: { path: 'notes/archive.md', content: 'duplicate', mode: 'create' } })).rejects.toThrow('already exists');
      await expect(target.execute({ callId: 'missing', tool: 'write_file', args: { path: 'notes/missing.md', content: 'missing', mode: 'overwrite' } })).rejects.toThrow('not found');
    });
  });

  test('stores files per assistant thread', async () => {
    await withTempDroneDataDir('assistant-artifacts-', async () => {
      const first = await runAssistantArtifactAction('thread-a', {
        action: 'write',
        path: 'status.md',
        content: '# Status\n\nStarted.',
      });
      await runAssistantArtifactAction('thread-b', {
        action: 'write',
        path: 'status.md',
        content: '# Other',
      });

      expect(first.file.path).toBe('status.md');
      expect((await readAssistantArtifactFile('thread-a', 'status.md')).content).toContain('Started');
      expect((await readAssistantArtifactFile('thread-b', 'status.md')).content).toBe('# Other');
      expect((await listAssistantArtifactFiles('thread-a')).map((file) => file.path)).toEqual(['status.md']);
    });
  });

  test('patch rejects stale revisions and ambiguous replacements', async () => {
    await withTempDroneDataDir('assistant-artifacts-patch-', async () => {
      const written = await runAssistantArtifactAction('thread-a', {
        action: 'write',
        path: 'status.md',
        content: 'one\ntwo\n',
      });
      await runAssistantArtifactAction('thread-a', {
        action: 'append',
        path: 'status.md',
        content: 'two\n',
      });

      await expect(
        runAssistantArtifactAction('thread-a', {
          action: 'patch',
          path: 'status.md',
          baseRevision: written.file.revision,
          patches: [{ oldText: 'one', newText: 'ONE' }],
        }),
      ).rejects.toThrow('revision changed');

      await expect(
        runAssistantArtifactAction('thread-a', {
          action: 'patch',
          path: 'status.md',
          patches: [{ oldText: 'two', newText: 'TWO' }],
        }),
      ).rejects.toThrow('ambiguous');
    });
  });

  test('rejects paths outside the thread artifact root', async () => {
    await withTempDroneDataDir('assistant-artifacts-path-', async () => {
      await expect(
        runAssistantArtifactAction('thread-a', {
          action: 'write',
          path: '../status.md',
          content: 'nope',
        }),
      ).rejects.toThrow('invalid artifact path');

      await expect(
        runAssistantArtifactAction('thread-a', {
          action: 'write',
          path: '.hidden.md',
          content: 'nope',
        }),
      ).rejects.toThrow('invalid artifact path');
    });
  });
});
