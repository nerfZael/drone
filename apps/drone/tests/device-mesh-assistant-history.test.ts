import { describe, expect, test } from 'bun:test';
import { MESH_CHAT_PAYLOAD_BYTES } from '@drone/device-protocol';
import { boundedAssistantHistory } from '../src/hub/device-mesh/features/cross-device-assistant/bounded-assistant-history';
import {
  compactChatQuestionRequests,
  compactNativeChatReadResponse,
} from '../src/hub/device-mesh/native-chat-response';

describe('mesh assistant history', () => {
  test('keeps responses below the mesh message budget', () => {
    const history: any = boundedAssistantHistory({
      threadId: 'thread_1',
      sessionId: 'session_1',
      entries: Array.from({ length: 80 }, (_, index) => ({
        sequence: index + 1,
        id: `message_${index + 1}`,
        timestamp: new Date().toISOString(),
        message: {
          role: 'toolResult',
          content: 'x'.repeat(30_000),
          details: {
            target: { id: 'remote:desktop:main', label: 'Desktop', rootLabel: 'main' },
            meshRoute: {
              assistantHomeDeviceId: 'vps',
              targetDeviceId: 'desktop',
              rootId: 'main',
            },
          },
        },
      })),
      page: { limit: 100, beforeCursor: 1, hasOlder: true },
    });
    const serialized = JSON.stringify(history);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(180 * 1024);
    expect(serialized).toContain('desktop');
    expect((history as any).entries.at(-1).id).toBe('message_80');
    expect(history.page.responseTruncated).toBe(true);
    expect(history.page.contentTruncated).toBe(true);
    expect(history.entries.at(-1).message.meshTruncated).toBe(true);
  });

  test('honors a smaller caller budget when queue metadata shares the response', () => {
    const history: any = boundedAssistantHistory(
      {
        threadId: 'thread_1',
        entries: Array.from({ length: 60 }, (_, index) => ({
          id: `message_${index}`,
          message: { role: 'assistant', content: 'x'.repeat(12_000) },
        })),
      },
      64 * 1024,
    );
    expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThanOrEqual(64 * 1024);
    expect(history.entries.at(-1).id).toBe('message_59');
  });

  test('returns no entries when response metadata consumes the history budget', () => {
    const history: any = boundedAssistantHistory(
      {
        threadId: 'thread_1',
        entries: [{ id: 'message_1', message: { role: 'assistant', content: 'Hello' } }],
      },
      0,
    );

    expect(history.entries).toEqual([]);
    expect(history.page).toMatchObject({ hasOlder: true, responseTruncated: true });
  });

  test('bounds one large multi-byte message and marks it as shortened', () => {
    const history: any = boundedAssistantHistory(
      {
        threadId: 'thread_1',
        entries: [
          {
            sequence: 1,
            id: 'message_1',
            message: { role: 'assistant', content: '🌍'.repeat(30_000) },
          },
        ],
      },
      8 * 1024,
    );
    expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThanOrEqual(8 * 1024);
    expect(history.entries[0].message.meshTruncated).toBe(true);
    expect(history.page.contentTruncated).toBe(true);
  });

  test('keeps unified native chat responses below the mesh frame limit', () => {
    const response = compactNativeChatReadResponse({
      nativeChatId: 'native_1',
      metadata: {
        droneId: 'drone_1',
        subscriptions: Array.from({ length: 40 }, (_, index) => ({
          id: `subscription_${index}`,
          intent: 'i'.repeat(2_000),
        })),
      },
      snapshot: {
        threads: [
          {
            id: 'native_1',
            title: 'Chat',
            systemPrompt: 'x'.repeat(100_000),
            queuedPrompts: Array.from({ length: 100 }, (_, index) => ({
              id: `prompt_${index}`,
              prompt: 'q'.repeat(20_000),
              status: 'queued',
            })),
          },
        ],
        pendingApprovals: Array.from({ length: 20 }, (_, index) => ({
          id: `approval_${index}`,
          threadId: 'native_1',
          status: 'pending',
          args: { content: 'a'.repeat(30_000) },
        })),
        questionRequests: Array.from({ length: 12 }, (_, index) => ({
          id: `questions_${index}`,
          droneId: 'drone_1',
          chatName: 'default',
          chatId: 'native_1',
          toolName: 'ask_questions',
          createdAt: `2026-08-26T10:${String(index).padStart(2, '0')}:00.000Z`,
          updatedAt: `2026-08-26T10:${String(index).padStart(2, '0')}:30.000Z`,
          status: 'submitted',
          questions: Array.from({ length: 30 }, (_, questionIndex) => ({
            id: `question_${questionIndex}`,
            question: 'q'.repeat(1_000),
            importance: 50,
            choices: [{ id: 'yes', label: 'Yes', description: 'd'.repeat(1_000) }],
          })),
          result: {
            status: 'submitted',
            requestId: `questions_${index}`,
            responses: Array.from({ length: 30 }, (_, questionIndex) => ({
              questionId: `question_${questionIndex}`,
              outcome: 'custom',
              text: 'a'.repeat(4_000),
            })),
            notes: 'n'.repeat(8_000),
          },
        })),
        streamingMessages: [{ role: 'assistant', content: 's'.repeat(100_000) }],
      },
      history: {
        threadId: 'native_1',
        entries: Array.from({ length: 100 }, (_, index) => ({
          id: `message_${index}`,
          message: { role: 'assistant', content: 'h'.repeat(30_000) },
        })),
      },
    });

    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(
      MESH_CHAT_PAYLOAD_BYTES,
    );
    expect(response.history.entries.at(-1).id).toBe('message_99');
    expect(response.thread?.queuedPrompts).toHaveLength(32);
    expect(response.pendingApprovals).toHaveLength(8);
    expect(response.questionRequests.length).toBeGreaterThan(0);
    expect(response.questionRequests.length).toBeLessThan(12);
  });

  test('keeps pending forms intact and compacts resolved questionnaires for mobile', () => {
    const pending = {
      id: 'questions_pending',
      chatId: 'native_1',
      status: 'pending',
      questions: [
        {
          id: 'scope',
          question: 'Which scope?',
          detailedExplanation: 'The complete explanation must remain available while answering.',
          importance: 90,
          choices: [{ id: 'small', label: 'Small', description: 'A complete description.' }],
        },
      ],
    };
    const resolved = {
      ...pending,
      id: 'questions_resolved',
      toolCallId: 'call_questions',
      status: 'submitted',
      result: {
        status: 'submitted',
        requestId: 'questions_resolved',
        responses: [
          { questionId: 'scope', outcome: 'custom', text: 'A carefully chosen custom scope.' },
        ],
      },
    };

    const compact = compactChatQuestionRequests([resolved, pending]);
    expect(compact).toHaveLength(2);
    expect(compact[0].questions[0].choices).toEqual([]);
    expect(compact[0].result.responses[0].text).toBe('A carefully chosen custom scope.');
    expect(compact[0].toolCallId).toBe('call_questions');
    expect(compact[1]).toBe(pending);
  });

  test('preserves transfer result pairing and bounded progress details', () => {
    const history: any = boundedAssistantHistory({
      threadId: 'thread_transfer',
      sessionId: 'session_transfer',
      entries: [
        {
          sequence: 1,
          id: 'transfer_result',
          timestamp: new Date().toISOString(),
          message: {
            role: 'toolResult',
            toolCallId: 'call_transfer',
            toolName: 'transfer_files',
            isError: true,
            content: 'Transfer partially completed',
            details: {
              type: 'workspace_transfer',
              phase: 'failed',
              source: { targetId: 'source', targetLabel: 'Source', path: 'folder' },
              destination: {
                targetId: 'destination',
                targetLabel: 'Destination',
                path: 'copied-folder',
              },
              fileCount: 500,
              completedFiles: 250,
              totalBytes: 500_000,
              transferredBytes: 250_000,
              retries: 5,
              resumeToken: 'tr1_250_0123456789abcdef',
              failure: {
                sourcePath: 'folder/failed.txt',
                destinationPath: 'copied-folder/failed.txt',
                error: 'connection failed',
                resumable: true,
              },
              files: Array.from({ length: 500 }, (_, index) => ({
                sourcePath: `folder/${String(index).padStart(3, '0')}-${'x'.repeat(500)}.txt`,
                destinationPath: `copied-folder/${String(index).padStart(3, '0')}.txt`,
                size: 1_000,
                transferredBytes: index < 250 ? 1_000 : 0,
                retries: 0,
                status: index < 250 ? 'completed' : index === 250 ? 'failed' : 'pending',
              })),
            },
          },
        },
      ],
      page: { limit: 1, beforeCursor: null, hasOlder: false },
    });

    const message = history.entries[0].message;
    expect(message).toMatchObject({
      toolCallId: 'call_transfer',
      toolName: 'transfer_files',
      isError: true,
      details: {
        type: 'workspace_transfer',
        phase: 'failed',
        fileCount: 500,
        completedFiles: 250,
        filesTruncated: 484,
      },
    });
    expect(message.details.files.some((file: any) => file.status === 'failed')).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThanOrEqual(180 * 1024);
  });
});
