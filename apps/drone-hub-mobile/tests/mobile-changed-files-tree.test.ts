import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

describe('mobile changed files tree', () => {
  test('renders shared directory nodes instead of a flat path list', () => {
    const treeSource = readFileSync(
      new URL('../src/local-assistant/MobileChangedFilesTree.tsx', import.meta.url),
      'utf8',
    );
    const transcriptSource = readFileSync(
      new URL('../src/local-assistant/LocalAssistantTranscript.tsx', import.meta.url),
      'utf8',
    );

    expect(treeSource).toContain('buildAgentRunChangeTree(entries)');
    expect(treeSource).toContain("node.kind === 'file'");
    expect(treeSource).toContain('node.children.map');
    expect(treeSource).toMatch(/\{collapsed \? \(\s*<View style=\{\[styles\.stats/);
    expect(transcriptSource).toContain('<MobileChangedFilesTree');
    expect(transcriptSource).toContain('{name}');
  });
});
