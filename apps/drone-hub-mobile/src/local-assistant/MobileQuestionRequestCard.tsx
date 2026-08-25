import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChatQuestionRequest, ChatQuestionResponse } from '@drone/assistant-chat';
import { Button, Card } from '../components/Ui';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import { NativeMarkdown } from './NativeMarkdown';

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
  const complete = request.questions.every((question) => {
    const draft = drafts[question.id];
    return draft != null && (draft.outcome !== 'custom' || draft.text.trim().length > 0);
  });
  const locked = busy || disabled;

  return (
    <Card style={styles.card}>
      <Text style={styles.eyebrow}>Input requested</Text>
      {request.questions.map((question, index) => {
        const draft = drafts[question.id];
        return (
          <View key={question.id} style={styles.question}>
            <Text style={styles.questionTitle}>
              {index + 1}. {question.question}
            </Text>
            <Text style={styles.importance}>Importance {question.importance}/100</Text>
            {question.detailedExplanation ? (
              <NativeMarkdown text={question.detailedExplanation} />
            ) : null}
            {question.choices.map((choice) => {
              const selected = draft?.outcome === 'choice' && draft.choiceId === choice.id;
              return (
                <Pressable
                  key={choice.id}
                  disabled={locked}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: locked }}
                  onPress={() =>
                    setDrafts((current) => ({
                      ...current,
                      [question.id]: { outcome: 'choice', choiceId: choice.id },
                    }))
                  }
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <View style={[styles.radio, selected && styles.radioSelected]} />
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
                </Pressable>
              );
            })}
            <Pressable
              disabled={locked}
              onPress={() =>
                setDrafts((current) => ({
                  ...current,
                  [question.id]: { outcome: 'custom', text: '' },
                }))
              }
              style={[styles.option, draft?.outcome === 'custom' && styles.optionSelected]}
            >
              <View style={[styles.radio, draft?.outcome === 'custom' && styles.radioSelected]} />
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
              onPress={() =>
                setDrafts((current) => ({
                  ...current,
                  [question.id]: { outcome: 'skipped' },
                }))
              }
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
          {notes.trim() ? 'Send note and skip' : 'Skip all'}
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
  card: { marginHorizontal: 12, marginBottom: 10, gap: 10 },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  question: { gap: 7, paddingBottom: 8 },
  questionTitle: { color: colors.textStrong, fontSize: 14, fontWeight: '800', lineHeight: 20 },
  importance: { color: colors.muted, fontSize: 10 },
  option: {
    flexDirection: 'row',
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
  },
  optionSelected: { borderColor: colors.accent, backgroundColor: colors.accentDark },
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
  skipQuestion: { color: colors.muted, fontSize: 11, paddingVertical: 4 },
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
});
