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
    expect(source).toContain('borderColor: colors.border');
    expect(source).toContain('backgroundColor: colors.whiteWashSoft');
    expect(source).not.toContain('borderLeftColor: colors.accent');
    expect(source).not.toContain('Input requested');
    expect(source).toContain('styles.questionMetaRow');
    expect(source).not.toContain('questionNavigationRow:');
    expect(source).toContain('optionLetter(choiceIndex)');
    expect(source).toContain('Add optional notes for the agent…');
    expect(source).not.toContain('styles.notesLabel');
    expect(source).toContain('Skip questionnaire');
    expect(source).toContain('`Submit all ${questionCount}`');
  });

  test('renders completed answers as a compact read-only mobile summary', () => {
    const source = readFileSync(
      new URL('../src/local-assistant/MobileQuestionResultCard.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('accessibilityRole="summary"');
    expect(source).toContain('Answers submitted');
    expect(source).toContain('Additional notes');
    expect(source).toContain('responseText(responses.get(question.id))');
    expect(source).not.toContain('Submit answers');

    const screenSource = readFileSync(
      new URL('../src/screens/DronesScreen.tsx', import.meta.url),
      'utf8',
    );
    expect(screenSource).toContain('Array.isArray(result?.questionRequests)');
    expect(screenSource).toContain('<MobileQuestionResultCard request={request} />');
    expect(screenSource).toContain("request.status === 'pending'");
    expect(screenSource).toContain('questionRequests={questionRequests}');

    const transcriptSource = readFileSync(
      new URL('../src/local-assistant/LocalAssistantTranscript.tsx', import.meta.url),
      'utf8',
    );
    expect(transcriptSource).toContain("kind: 'question' as const");
    expect(transcriptSource).toContain(
      "request.status === 'pending' ? request.createdAt : request.updatedAt",
    );
    expect(transcriptSource).toContain('renderQuestionRequest?.(entry.request)');
    expect(transcriptSource).toContain('questionRequestsByRunKey');
    expect(transcriptSource).toContain('interstitialContent=');
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
