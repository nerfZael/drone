import { describe, expect, test } from 'bun:test';

import {
  agentsMdNameFromUpload,
  prepareAgentsMdUpload,
  validateAgentsMdUploadFile,
} from '../src/droneHub/app/agents-md-file-import';

describe('AGENTS.md desktop file import', () => {
  test('derives readable library names from supported filenames', () => {
    expect(agentsMdNameFromUpload('Backend work.md')).toBe('Backend work');
    expect(agentsMdNameFromUpload('AGENTS.markdown')).toBe('AGENTS');
    expect(agentsMdNameFromUpload('review.txt')).toBe('review');
  });

  test('normalizes uploaded text before creating a library entry', async () => {
    const prepared = await prepareAgentsMdUpload(
      new File(['# Instructions\r\nRun tests.'], 'Backend.md', {
        type: 'text/markdown',
      }),
    );

    expect(prepared).toEqual({
      name: 'Backend',
      content: '# Instructions\nRun tests.\n',
    });
  });

  test('rejects unsupported and oversized desktop files', () => {
    expect(() => validateAgentsMdUploadFile({ name: 'rules.pdf', size: 100 })).toThrow(
      'must be a .md, .markdown, or .txt file',
    );
    expect(() =>
      validateAgentsMdUploadFile({ name: 'rules.md', size: 2 * 1024 * 1024 + 1 }),
    ).toThrow('must be at most 2 MiB');
  });

  test('rejects binary-looking content even with a text extension', async () => {
    await expect(prepareAgentsMdUpload(new File(['text\0binary'], 'rules.md'))).rejects.toThrow(
      'does not appear to be a text file',
    );
  });
});
