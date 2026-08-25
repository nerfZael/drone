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
      <View style={styles.cardHeader}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>Input requested</Text>
          <Text style={styles.headerHint}>Choose an answer, write your own, or skip.</Text>
        </View>
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
      {visibleQuestions.map((question) => {
        const index = request.questions.indexOf(question);
        const draft = drafts[question.id];
        return (
          <View key={question.id} style={styles.question}>
            <Text style={styles.questionTitle}>
              {singleQuestion ? question.question : `${index + 1}. ${question.question}`}
            </Text>
            {singleQuestion ? (
              <View style={styles.questionNavigationRow}>
                <Text style={styles.questionCount}>
                  {activeQuestionIndex + 1} of {questionCount}
                </Text>
                <View style={styles.questionNavigation}>
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
                </View>
              </View>
            ) : null}
            <Text style={styles.importance}>Importance {question.importance}/100</Text>
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
                  {singleQuestion ? (
                    <View style={[styles.optionNumber, selected && styles.optionNumberSelected]}>
                      <Text style={styles.optionNumberText}>{choiceIndex + 1}</Text>
                    </View>
                  ) : (
                    <View style={[styles.radio, selected && styles.radioSelected]} />
                  )}
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
              {singleQuestion ? (
                <View style={styles.optionNumber}>
                  <Text style={styles.optionNumberText}>Aa</Text>
                </View>
              ) : (
                <View style={[styles.radio, draft?.outcome === 'custom' && styles.radioSelected]} />
              )}
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
      <Text style={styles.notesLabel}>Additional notes</Text>
      <ThemedTextInput
        editable={!locked}
        multiline
        maxLength={8_000}
        value={notes}
        placeholder="Optional context for the agent"
        placeholderTextColor={colors.muted}
        onChangeText={setNotes}
        style={styles.input}
      />
      {!complete ? (
        <Text style={styles.warning}>Choose an answer or explicitly skip every question.</Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          tone="quiet"
          disabled={locked}
          onPress={() => onSkip(notes.trim() || undefined)}
          style={styles.button}
        >
          Skip all
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
          Submit answers
        </Button>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 10,
    gap: 10,
    borderWidth: 0,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    borderRadius: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 6,
    shadowOpacity: 0,
    elevation: 0,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: {
    color: colors.textStrong,
    fontSize: 13,
    fontWeight: '700',
  },
  headerHint: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  modeToggle: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 7 },
  modeToggleText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  question: { gap: 7, paddingBottom: 4 },
  questionTitle: {
    color: colors.textStrong,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  questionNavigationRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  questionNavigation: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  navigationButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  questionCount: { color: colors.muted, fontSize: 11 },
  importance: { color: colors.muted, fontSize: 10 },
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
  optionNumberSelected: { backgroundColor: colors.surface1 },
  optionNumberText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  radio: {
    width: 14,
    height: 14,
    marginTop: 2,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.muted,
  },
  radioSelected: { borderWidth: 4, borderColor: colors.accent },
  optionBody: { flex: 1, gap: 2 },
  optionTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  optionTitle: { color: colors.textStrong, fontSize: 12, fontWeight: '700' },
  recommended: { color: colors.accent, fontSize: 8, fontWeight: '800', textTransform: 'uppercase' },
  optionDescription: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  skipButton: { alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center', paddingHorizontal: 8 },
  skipQuestion: { color: colors.muted, fontSize: 11 },
  skipped: { color: colors.textStrong, fontWeight: '700' },
  notesLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  input: {
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    color: colors.text,
    padding: 9,
    textAlignVertical: 'top',
  },
  warning: { color: colors.warning, fontSize: 11 },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1 },
  disabled: { opacity: 0.32 },
  pressed: { opacity: 0.7 },
});
