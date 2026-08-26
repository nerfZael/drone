import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChatQuestionRequest, ChatQuestionResponse } from '@drone/assistant-chat';
import Check from 'lucide-react-native/icons/check';
import Minus from 'lucide-react-native/icons/minus';
import { colors, radii } from '../theme';
import { useMobileReadingDensity } from '../mobile-reading-density';

function responseText(response: ChatQuestionResponse | undefined): string {
  if (!response || response.outcome === 'skipped') return 'Skipped';
  return response.outcome === 'choice' ? response.label : response.text;
}

function skippedTitle(request: ChatQuestionRequest): string {
  if (request.result?.status !== 'skipped') return 'Questions skipped';
  if (request.result.reason === 'queued_message_pending') return 'Skipped for a queued message';
  if (request.result.reason === 'chat_stopped') return 'Canceled when the chat stopped';
  return 'Questions skipped';
}

export function MobileQuestionResultCard({ request }: { request: ChatQuestionRequest }) {
  const comfortable = useMobileReadingDensity() === 'comfortable';
  const result = request.result;
  if (!result) return null;
  const submitted = result.status === 'submitted';
  const responses = submitted
    ? new Map(result.responses.map((response) => [response.questionId, response]))
    : null;

  return (
    <View
      accessible
      accessibilityRole="summary"
      style={styles.card}
    >
      <View style={styles.header}>
        <View style={[styles.statusIcon, submitted && styles.statusIconSubmitted]}>
          {submitted ? (
            <Check color={colors.online} size={14} strokeWidth={2.5} />
          ) : (
            <Minus color={colors.mutedDim} size={14} strokeWidth={2.5} />
          )}
        </View>
        <Text style={[styles.title, comfortable && styles.titleComfortable]}>
          {submitted ? 'Answers submitted' : skippedTitle(request)}
        </Text>
      </View>
      {responses ? (
        <View style={styles.answers}>
          {request.questions.map((question) => (
            <View key={question.id} style={styles.answer}>
              <Text style={[styles.question, comfortable && styles.questionComfortable]}>
                {question.question}
              </Text>
              <Text style={[styles.response, comfortable && styles.responseComfortable]}>
                {responseText(responses.get(question.id))}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {result.notes ? (
        <View style={[styles.notes, responses && styles.notesSeparated]}>
          <Text style={[styles.question, comfortable && styles.questionComfortable]}>
            Additional notes
          </Text>
          <Text style={[styles.response, comfortable && styles.responseComfortable]}>
            {result.notes}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 10,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.large,
    backgroundColor: colors.chatCard,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.controlSurface,
  },
  statusIconSubmitted: { backgroundColor: colors.onlineDark },
  title: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  titleComfortable: { fontSize: 15 },
  answers: { gap: 10 },
  answer: { gap: 2 },
  question: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  questionComfortable: { fontSize: 13, lineHeight: 19 },
  response: { color: colors.textStrong, fontSize: 14, lineHeight: 20 },
  responseComfortable: { fontSize: 15, lineHeight: 22 },
  notes: { gap: 2 },
  notesSeparated: { paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
});
