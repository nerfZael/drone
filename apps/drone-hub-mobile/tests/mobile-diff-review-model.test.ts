import { describe, expect, test } from 'bun:test';
import type { AgentRunFileChangeEntry } from '@blip/protocol';
import {
  buildMobileDiffRenderModel,
  MOBILE_DIFF_MAX_CHARACTERS,
  MOBILE_DIFF_MAX_LINES,
  mobileChangedFileStatusPresentation,
  mobileDiffLoadError,
} from '../src/local-assistant/mobile-diff-review-model';

const entry: AgentRunFileChangeEntry = {
  path: 'src/example.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
};

describe('mobile diff review model', () => {
  test('parses unified hunks into numbered context, removal, and addition lines', () => {
    const model = buildMobileDiffRenderModel({
      entry,
      patch: [
        'diff --git a/src/example.ts b/src/example.ts',
        '--- a/src/example.ts',
        '+++ b/src/example.ts',
        '@@ -10,3 +10,4 @@ function example() {',
        ' context',
        '-old value',
        '+new value',
        '+extra value',
        ' tail',
      ].join('\r\n'),
    });

    expect(model.kind).toBe('diff');
    if (model.kind !== 'diff') return;
    expect(model.hunks).toHaveLength(1);
    expect(model.hunks[0]?.lines).toEqual([
      { kind: 'context', content: 'context', oldLine: 10, newLine: 10 },
      { kind: 'deletion', content: 'old value', oldLine: 11, newLine: null },
      { kind: 'addition', content: 'new value', oldLine: null, newLine: 11 },
      { kind: 'addition', content: 'extra value', oldLine: null, newLine: 12 },
      { kind: 'context', content: 'tail', oldLine: 12, newLine: 13 },
    ]);
  });

  test('recognizes binary, empty, malformed, truncated, and too-large patches', () => {
    expect(
      buildMobileDiffRenderModel({
        entry: { ...entry, binary: true },
        patch: '',
      }).kind,
    ).toBe('binary');
    expect(buildMobileDiffRenderModel({ entry, patch: '' }).kind).toBe('empty');
    expect(buildMobileDiffRenderModel({ entry, patch: 'not a unified diff' }).kind).toBe(
      'malformed',
    );
    expect(
      buildMobileDiffRenderModel({
        entry,
        patch: '@@ -1 +1 @@\n-old\n+new',
        truncated: true,
      }),
    ).toMatchObject({ kind: 'diff', truncated: true });
    expect(
      buildMobileDiffRenderModel({
        entry,
        patch: `@@ -1 +1 @@\n+${'x'.repeat(MOBILE_DIFF_MAX_CHARACTERS)}`,
      }).kind,
    ).toBe('too-large');
    expect(
      buildMobileDiffRenderModel({
        entry,
        patch: Array.from({ length: MOBILE_DIFF_MAX_LINES + 1 }, () => ' context').join('\n'),
      }).kind,
    ).toBe('too-large');
  });

  test('provides clear file statuses', () => {
    expect(mobileChangedFileStatusPresentation({ status: 'added' })).toEqual({
      code: 'A',
      label: 'Added',
      tone: 'success',
    });
    expect(mobileChangedFileStatusPresentation({ status: 'modified' }).label).toBe('Modified');
    expect(mobileChangedFileStatusPresentation({ status: 'deleted' })).toEqual({
      code: 'D',
      label: 'Deleted',
      tone: 'danger',
    });
  });

  test('classifies retryable, unavailable, and too-large load failures', () => {
    expect(mobileDiffLoadError({ code: 'HUB_413', message: 'size limit' })).toEqual({
      kind: 'too-large',
      message: 'size limit',
      retryable: false,
    });
    expect(mobileDiffLoadError({ code: 'HUB_404', message: 'expired' })).toEqual({
      kind: 'unavailable',
      message: 'expired',
      retryable: false,
    });
    expect(mobileDiffLoadError({ code: 'HUB_500', message: 'try later' })).toEqual({
      kind: 'error',
      message: 'try later',
      retryable: true,
    });
  });
});
