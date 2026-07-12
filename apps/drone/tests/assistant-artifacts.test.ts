import { describe, expect, test } from 'bun:test';

import {
  listAssistantArtifactFiles,
  readAssistantArtifactFile,
  runAssistantArtifactAction,
  validateAssistantPromptImages,
} from '../src/hub/assistant-artifacts';
import { AssistantArtifactsTarget } from '../src/hub/assistant/targets/assistant-artifacts-target';
import { withTempDroneDataDir } from './test-helpers';

describe('assistant artifacts', () => {
  test('validates prompt image payloads before persistence', () => {
    expect(validateAssistantPromptImages([{ mime: 'image/png', dataBase64: 'aW1hZ2U=' }])).toEqual([
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
    ]);
    expect(() => validateAssistantPromptImages([{ mime: 'text/plain', dataBase64: 'aW1hZ2U=' }])).toThrow('invalid prompt image type');
    expect(() => validateAssistantPromptImages([{ mime: 'image/png', dataBase64: 'not base64' }])).toThrow('looks invalid');
  });

  test('implements supported shared workspace target operations', async () => {
    await withTempDroneDataDir('assistant-artifact-target-', async () => {
      const target = new AssistantArtifactsTarget('thread-target');
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

      expect(read.content[0]?.type === 'text' ? read.content[0].text : '').toContain('1 | target content');
      expect(read.details).toMatchObject({ path: 'notes/plan.md', offset: 0, returnedLines: 1, revision: expect.any(String) });
      expect(rootList.content[0]?.type === 'text' ? rootList.content[0].text : '').toContain('dir  notes');
      expect(dottedRootList.content[0]?.type === 'text' ? dottedRootList.content[0].text : '').toContain('dir  notes');
      expect(notesList.content[0]?.type === 'text' ? notesList.content[0].text : '').toContain('file notes/plan.md');
      expect(target.descriptor.capabilities).not.toContain('shell.execute');
      expect(target.descriptor.capabilities).toContain('directories.create');
      await expect(target.execute({ callId: 'duplicate', tool: 'write_file', args: { path: 'notes/plan.md', content: 'duplicate', mode: 'create' } })).rejects.toThrow('already exists');
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
