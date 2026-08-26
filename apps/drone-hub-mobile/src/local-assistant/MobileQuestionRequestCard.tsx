import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatQuestionRequest, ChatQuestionResponse } from '@drone/assistant-chat';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Button, Card } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import { NativeMarkdown } from './NativeMarkdown';
import {
  setMobileQuestionViewMode,
  useMobileQuestionViewMode,
} from './mobile-question-view-mode';

type Draft =
  | { outcome: 'choice'; choiceId: string }
  | { outcome: 'custom'; text: string }
  | { outcome: 'skipped' };

function optionLetter(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode('A'.charCodeAt(0) + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function MobileQuestionRequestCard({
  request,
  busy,
  disabled,
  onSubmit,
  onSkip,
}: {
  request: ChatQuestionRequest;
  busy?: boolean;
  disabled?: boolean;
  onSubmit(input: { responses: ChatQuestionResponse[]; notes?: string }): void;
  onSkip(notes?: string): void;
}) {
  const [drafts, setDrafts] = React.useState<Record<string, Draft | undefined>>(() =>
    Object.fromEntries(
      request.questions.map((question) => {
        const recommended = question.choices.find((choice) => choice.recommended);
        return [
          question.id,
          recommended ? { outcome: 'choice', choiceId: recommended.id } : undefined,
        ];
      }),
    ),
  );
  const [notes, setNotes] = React.useState('');
  const [activeQuestionIndex, setActiveQuestionIndex] = React.useState(0);
  const viewMode = useMobileQuestionViewMode();
  const singleQuestion = viewMode === 'single';
  const questionCount = request.questions.length;
  const visibleQuestions = singleQuestion
    ? request.questions.slice(activeQuestionIndex, activeQuestionIndex + 1)
    : request.questions;
  const complete = request.questions.every((question) => {
    const draft = drafts[question.id];
    return draft != null && (draft.outcome !== 'custom' || draft.text.trim().length > 0);
  });
  const locked = busy || disabled;
  const goToQuestion = (index: number) => {
    setActiveQuestionIndex(Math.max(0, Math.min(questionCount - 1, index)));
  };
  const advanceQuestion = () => {
    if (!singleQuestion || activeQuestionIndex >= questionCount - 1) return;
    setActiveQuestionIndex((current) => Math.min(questionCount - 1, current + 1));
  };

  return (
    <Card style={styles.card}>
      {visibleQuestions.map((question) => {
        const index = request.questions.indexOf(question);
        const draft = drafts[question.id];
        return (
          <View key={question.id} style={styles.question}>
            <View style={styles.questionMetaRow}>
              <Text style={styles.importance}>Importance {question.importance}/100</Text>
              {singleQuestion || index === 0 ? (
                <View style={styles.questionControls}>
                  {singleQuestion ? (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Previous question"
                        disabled={locked || activeQuestionIndex === 0}
                        hitSlop={6}
                        onPress={() => goToQuestion(activeQuestionIndex - 1)}
                        style={({ pressed }) => [
                          styles.navigationButton,
                          activeQuestionIndex === 0 && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <ChevronLeft color={colors.textSecondary} size={17} strokeWidth={2.2} />
                      </Pressable>
                      <Text style={styles.questionCount}>
                        {activeQuestionIndex + 1} of {questionCount}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Next question"
                        disabled={locked || activeQuestionIndex >= questionCount - 1}
                        hitSlop={6}
                        onPress={() => goToQuestion(activeQuestionIndex + 1)}
                        style={({ pressed }) => [
                          styles.navigationButton,
                          activeQuestionIndex >= questionCount - 1 && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <ChevronRight color={colors.textSecondary} size={17} strokeWidth={2.2} />
                      </Pressable>
                    </>
                  ) : null}
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: singleQuestion, disabled: locked }}
                    accessibilityLabel="Show one question at a time"
                    disabled={locked}
                    hitSlop={6}
                    onPress={() => setMobileQuestionViewMode(singleQuestion ? 'all' : 'single')}
                    style={({ pressed }) => [styles.modeToggle, pressed && styles.pressed]}
                  >
                    <Text style={styles.modeToggleText}>
                      {singleQuestion ? 'Show all' : 'One at a time'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
            <Text style={styles.questionTitle}>
              {singleQuestion ? question.question : `${index + 1}. ${question.question}`}
            </Text>
            {question.detailedExplanation ? (
              <NativeMarkdown text={question.detailedExplanation} />
            ) : null}
            {question.choices.map((choice, choiceIndex) => {
              const selected = draft?.outcome === 'choice' && draft.choiceId === choice.id;
              return (
                <Pressable
                  key={choice.id}
                  disabled={locked}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: locked }}
                  onPress={() => {
                    setDrafts((current) => ({
                      ...current,
                      [question.id]: { outcome: 'choice', choiceId: choice.id },
                    }));
                    advanceQuestion();
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    singleQuestion ? styles.optionSingle : styles.optionAll,
                    selected && styles.optionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.optionNumber, selected && styles.optionNumberSelected]}>
                    <Text
                      style={[styles.optionNumberText, selected && styles.optionNumberTextSelected]}
                    >
                      {optionLetter(choiceIndex)}
                    </Text>
                  </View>
                  <View style={styles.optionBody}>
                    <View style={styles.optionTitleRow}>
                      <Text style={styles.optionTitle}>{choice.label}</Text>
                      {choice.recommended ? (
                        <Text style={styles.recommended}>Recommended</Text>
                      ) : null}
                    </View>
                    {choice.description ? (
                      <Text style={styles.optionDescription}>{choice.description}</Text>
                    ) : null}
                  </View>
                  {singleQuestion && selected ? (
                    <ChevronRight color={colors.mutedDim} size={16} strokeWidth={2} />
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              disabled={locked}
              accessibilityRole="radio"
              accessibilityState={{ checked: draft?.outcome === 'custom', disabled: locked }}
              onPress={() =>
                setDrafts((current) => ({
                  ...current,
                  [question.id]: { outcome: 'custom', text: '' },
                }))
              }
              style={({ pressed }) => [
                styles.option,
                singleQuestion ? styles.optionSingle : styles.optionAll,
                draft?.outcome === 'custom' && styles.optionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.optionNumber,
                  draft?.outcome === 'custom' && styles.optionNumberSelected,
                ]}
              >
                <Text
                  style={[
                    styles.optionNumberText,
                    draft?.outcome === 'custom' && styles.optionNumberTextSelected,
                  ]}
                >
                  {optionLetter(question.choices.length)}
                </Text>
              </View>
              <Text style={styles.optionTitle}>Something else</Text>
            </Pressable>
            {draft?.outcome === 'custom' ? (
              <ThemedTextInput
                editable={!locked}
                multiline
                maxLength={4_000}
                value={draft.text}
                placeholder="Type your answer"
                placeholderTextColor={colors.muted}
                onChangeText={(text) =>
                  setDrafts((current) => ({
                    ...current,
                    [question.id]: { outcome: 'custom', text },
                  }))
                }
                style={styles.input}
              />
            ) : null}
            <Pressable
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel="Skip this question"
              onPress={() => {
                setDrafts((current) => ({
                  ...current,
                  [question.id]: { outcome: 'skipped' },
                }));
                advanceQuestion();
              }}
              style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
            >
              <Text style={[styles.skipQuestion, draft?.outcome === 'skipped' && styles.skipped]}>
                {draft?.outcome === 'skipped' ? 'Question skipped' : 'Skip this question'}
              </Text>
            </Pressable>
          </View>
        );
      })}
      <ThemedTextInput
        accessibilityLabel="Additional notes"
        editable={!locked}
        multiline
        maxLength={8_000}
        value={notes}
        placeholder="Add optional notes for the agent…"
        placeholderTextColor={colors.muted}
        onChangeText={setNotes}
        style={styles.notesInput}
      />
      {!complete ? (
        <Text style={styles.warning}>Answer or skip each question to submit.</Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          tone="quiet"
          disabled={locked}
          onPress={() => onSkip(notes.trim() || undefined)}
          style={styles.button}
        >
          Skip questionnaire
        </Button>
        <Button
          disabled={locked || !complete}
          loading={busy}
          onPress={() => {
            const responses = request.questions.map((question): ChatQuestionResponse => {
              const draft = drafts[question.id]!;
              if (draft.outcome === 'skipped')
                return { questionId: question.id, outcome: 'skipped' };
              if (draft.outcome === 'custom') {
                return { questionId: question.id, outcome: 'custom', text: draft.text.trim() };
              }
              const choice = question.choices.find((candidate) => candidate.id === draft.choiceId)!;
              return {
                questionId: question.id,
                outcome: 'choice',
                choiceId: choice.id,
                label: choice.label,
              };
            });
            onSubmit({ responses, ...(notes.trim() ? { notes: notes.trim() } : {}) });
          }}
          style={styles.button}
        >
          {questionCount === 1 ? 'Submit answer' : `Submit all ${questionCount}`}
        </Button>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.whiteWashSoft,
    paddingHorizontal: 11,
    paddingVertical: 10,
    shadowOpacity: 0,
    elevation: 0,
  },
  modeToggle: { minHeight: 30, justifyContent: 'center', paddingHorizontal: 7, borderRadius: 7 },
  modeToggleText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  question: { gap: 7, paddingBottom: 2 },
  questionMetaRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  questionControls: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  questionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
  },
  navigationButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  questionCount: { minWidth: 34, textAlign: 'center', color: colors.textSecondary, fontSize: 10 },
  importance: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: colors.controlSurface,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 46,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionAll: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  optionSingle: { borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  optionSelected: {
    borderBottomColor: 'transparent',
    borderRadius: 8,
    backgroundColor: colors.controlSurface,
  },
  optionNumber: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.controlSurface,
  },
  optionNumberSelected: { backgroundColor: colors.accent },
  optionNumberText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  optionNumberTextSelected: { color: colors.onAccent },
  optionBody: { flex: 1, gap: 2 },
  optionTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  optionTitle: { color: colors.textStrong, fontSize: 12, fontWeight: '700' },
  recommended: { color: colors.accent, fontSize: 8, fontWeight: '800', textTransform: 'uppercase' },
  optionDescription: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  skipButton: { alignSelf: 'flex-end', minHeight: 30, justifyContent: 'center', paddingHorizontal: 7 },
  skipQuestion: { color: colors.muted, fontSize: 11 },
  skipped: { color: colors.textStrong, fontWeight: '700' },
  input: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.text,
    padding: 9,
    textAlignVertical: 'top',
  },
  notesInput: {
    minHeight: 42,
    maxHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: 9,
    paddingVertical: 8,
    textAlignVertical: 'top',
  },
  warning: { color: colors.warning, fontSize: 11 },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1 },
  disabled: { opacity: 0.32 },
  pressed: { opacity: 0.7 },
});
