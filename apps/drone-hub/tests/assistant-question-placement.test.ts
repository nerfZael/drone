import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('assistant question placement', () => {
  test('renders structured-chat questions inside the scrollable transcript', () => {
    const source = readFileSync(
      new URL('../src/droneHub/app/SelectedDroneWorkspace.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('key: `questions:${request.id}`');
    expect(source).toContain("kind: 'approval'");
    expect(source).toContain('mergeChatTranscriptTimeline(');
    expect(source).toContain('for (const timelineEntry of externalTranscriptTimeline)');
    expect(source).toContain('externalQuestionTimelinePlacement.byGroupIndex');
    expect(source).toContain('toolCalls(message).some((call) => call.id === toolCallId)');
    expect(source).toContain('externalQuestionRequests.length > 0,');
    expect(source).toContain("request.status === 'pending'");
    expect(source).toContain('<AssistantQuestionResultCard request={request} />');
    expect(source).toContain("chatUiMode === 'cli' &&");
    expect(source).toContain('pendingExternalQuestionRequests.length > 0 ? (');
    expect(source).not.toContain('genericChatActive && externalQuestionRequests.length > 0 ? (');
  });

  test('keeps built-in chat results next to their tool run instead of appending history', () => {
    const source = readFileSync(
      new URL('../src/droneHub/assistant/AssistantDock.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('snapshot?.questionRequests ?? snapshot?.pendingQuestionRequests');
    expect(source).toContain('runToolCallIds.has(request.toolCallId)');
    expect(source).toContain('<AssistantQuestionResultCard request={request} />');
    expect(source).toContain('nativeTranscriptItems.splice(');
  });
});
