import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('mobile question request card', () => {
  test('uses compact touch navigation and advances after decisive answers', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/MobileQuestionRequestCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('useMobileQuestionViewMode()');
    expect(source).toContain('accessibilityLabel="Previous question"');
    expect(source).toContain('accessibilityLabel="Next question"');
    expect(source).toContain("{singleQuestion ? 'Show all' : 'One at a time'}");
    expect(source).toContain('styles.optionNumber');
    expect(source).toContain('advanceQuestion();');
    expect(source).toContain('minHeight: 46');
    expect(source).toContain('borderLeftColor: colors.accent');
    expect(source).toContain("backgroundColor: 'transparent'");
  });

  test('persists one display preference for every mobile questionnaire', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/mobile-question-view-mode.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("let viewMode: MobileQuestionViewMode = 'single'");
    expect(source).toContain('AsyncStorage.getItem(MOBILE_QUESTION_VIEW_MODE_STORAGE_KEY)');
    expect(source).toContain('AsyncStorage.setItem(MOBILE_QUESTION_VIEW_MODE_STORAGE_KEY, mode)');
    expect(source).toContain('React.useSyncExternalStore(');
    expect(source).toContain('hydrationRevision !== localRevision');
  });
});
