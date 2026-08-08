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
    const reviewSource = readFileSync(
      new URL('../src/local-assistant/MobileChangedFilesReviewModal.tsx', import.meta.url),
      'utf8',
    );
    const browserSource = readFileSync(
      new URL('../src/local-assistant/MobileChangedFilesBrowser.tsx', import.meta.url),
      'utf8',
    );
    const diffSource = readFileSync(
      new URL('../src/local-assistant/MobileChangedFilesDiff.tsx', import.meta.url),
      'utf8',
    );

    expect(treeSource).toContain('buildAgentRunChangeTree(entries)');
    expect(treeSource).toContain("node.kind === 'file'");
    expect(treeSource).toContain('node.children.map');
    expect(treeSource).not.toContain('NativeFolderTypeIcon');
    expect(treeSource).toContain('<ChevronRight');
    expect(treeSource).toContain('<ChevronDown');
    expect(treeSource).toMatch(/\{collapsed \? \(\s*<View style=\{\[styles\.stats/);
    expect(transcriptSource).toContain('<MobileChangedFilesTree');
    expect(transcriptSource).toContain('<NativeFileTypeIcon');
    expect(transcriptSource).toContain('path={entry.path}');
    expect(transcriptSource).toContain('styles.changedFilesFileAdditions');
    expect(transcriptSource).toContain('styles.changedFilesFileDeletions');
    expect(transcriptSource).toContain('exact changed-file attribution is unavailable');
    expect(transcriptSource).toContain('Totals include only attributed');
    expect(transcriptSource).toContain('userMessageFollowsLatestRunSummary');
    expect(transcriptSource).toContain("item.type === 'message' && item.message.role === 'user'");
    expect(transcriptSource).not.toContain(
      '<ChevronRight color={pressed ? colors.accent : colors.muted} size={12} />',
    );
    expect(transcriptSource).toContain('{name}');
    expect(transcriptSource).toContain('<MobileChangedFilesReviewModal');
    expect(transcriptSource).not.toContain('diff.patch.slice');
    expect(reviewSource).toContain('<MobileChangedFilesBrowser');
    expect(reviewSource).toContain('<MobileChangedFilesDiff');
    expect(reviewSource).toContain('Previous');
    expect(reviewSource).toContain('Next');
    expect(browserSource).toContain('<MobileChangedFilesTree');
    expect(browserSource).toContain('<NativeFileTypeIcon');
    expect(browserSource).toContain('path={entry.path}');
    expect(diffSource).toContain('<NativeFileTypeIcon path={entry.path}');
    expect(diffSource).toContain('<DiffLine');
  });
});
