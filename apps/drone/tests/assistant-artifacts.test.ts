import { describe, expect, test } from 'bun:test';

import {
  listAssistantArtifactFiles,
  readAssistantArtifactFile,
  runAssistantArtifactAction,
} from '../src/hub/assistant-artifacts';
import { AssistantArtifactsTarget } from '../src/hub/assistant/targets/assistant-artifacts-target';
import { withTempDroneDataDir } from './test-helpers';

describe('assistant artifacts', () => {
  test('implements supported shared workspace target operations', async () => {
    await withTempDroneDataDir('assistant-artifact-target-', async () => {
      const target = new AssistantArtifactsTarget('thread-target');
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

      expect(read.content[0]?.type === 'text' ? read.content[0].text : '').toBe('target content');
      expect(read.details).toMatchObject({ path: 'notes/plan.md', revision: expect.any(String) });
      expect(target.descriptor.capabilities).not.toContain('shell.execute');
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
